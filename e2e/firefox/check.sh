#!/bin/sh
# Loads dist/firefox-e2e into a real Firefox as a temporary add-on (through
# geckodriver's moz/addon/install, which BaseCase::install_addon sends) and checks
# that the background runs, that the recorder starts and that it records a click
# and typing on a page.
#
# It runs inside the image of seleniumbase-rs's docker/firefox-check (firefox-esr
# and geckodriver, nothing of this project), with the build mounted read-only:
#
#   docker build -t sbrs-firefox-check /path/to/seleniumbase-rs/docker/firefox-check
#   docker run --rm --shm-size 512m \
#     -v "$PWD/dist/firefox-e2e:/ext:ro" -v "$PWD/e2e/firefox/check.sh:/check.sh:ro" \
#     sbrs-firefox-check /bin/sh /check.sh
#   docker rmi sbrs-firefox-check
#
# WebDriver may not navigate to a moz-extension:// address, so the panel page (the
# popup's page) is shown in an iframe of an ordinary page: the e2e build lists it as a
# web-accessible resource for 127.0.0.1, and its uuid is fixed by a preference. The
# messages the popup's buttons send are sent from inside that frame. A headless
# Firefox has no toolbar to click.
set -eu

DRIVER=http://127.0.0.1:4444
PAGE=http://127.0.0.1:8000/index.html
EXT=${EXT:-/ext}
ADDON_ID=seleniumbase-rs-companion@seleniumbase-rs
UUID=7c1c6f1e-4b1f-4c43-9b43-0f5c0c8f9a11
OUT=/tmp/response.json
STATUS=0
ELEMENT=element-6066-11e4-a52e-4f735466cecf

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

call() {
    method=$1
    path=$2
    body=${3-}
    printf '>>> %s %s %s\n' "$method" "$path" "$body" >&2
    if [ -n "$body" ]; then
        STATUS=$(curl -sS -o "$OUT" -w '%{http_code}' -X "$method" -H 'content-type: application/json' -d "$body" "$DRIVER$path")
    else
        STATUS=$(curl -sS -o "$OUT" -w '%{http_code}' -X "$method" "$DRIVER$path")
    fi
    printf '<<< HTTP %s %s\n' "$STATUS" "$(head -c 600 "$OUT")" >&2
}

ok() { [ "$STATUS" = 200 ] || fail "expected HTTP 200 for: $*"; }

# run SESSION SCRIPT: runs an async script (its last argument is the callback) in
# the current window and prints its value as JSON on stdout.
run() {
    body=$(jq -nc --arg s "$2" '{script: $s, args: []}')
    call POST "/session/$1/execute/async" "$body"
    ok running a script
    jq -c .value "$OUT"
}

# send SESSION JSON: sends a message to the extension's background from the panel page.
send() {
    run "$1" "const done = arguments[arguments.length - 1]; browser.runtime.sendMessage($2).then(done, (e) => done({ ok: false, error: String(e) }));"
}

say "versions"
geckodriver --version >/tmp/gd-version 2>&1; head -n 1 /tmp/gd-version
firefox-esr --version

say "the add-on directory"
[ -f "$EXT/manifest.json" ] || fail "no $EXT/manifest.json: mount dist/firefox-e2e at $EXT"
jq -c '{name, version, manifest_version, background, permissions, host_permissions, optional_host_permissions}' "$EXT/manifest.json"

mkdir -p /tmp/site
cat >/tmp/site/index.html <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>
<input id="q" name="q" type="text" data-testid="query">
<button id="go" type="button" data-test="go">Go</button>
</body></html>
HTML
cat >/tmp/site/host.html <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>panel host</title></head><body>
<iframe src="moz-extension://$UUID/ui/panel.html" width="500" height="600"></iframe>
</body></html>
HTML
python3 -m http.server 8000 --bind 127.0.0.1 --directory /tmp/site >/tmp/http.log 2>&1 &
geckodriver --host 127.0.0.1 --port 4444 --log warn >/tmp/geckodriver.log 2>&1 &
for _ in $(seq 1 50); do
    curl -fsS "$DRIVER/status" >/dev/null 2>&1 && break
    sleep 0.2
done
curl -fsS "$DRIVER/status" >/dev/null || fail "geckodriver did not start: $(cat /tmp/geckodriver.log)"

say "new headless Firefox session with the add-on's uuid fixed"
UUIDS=$(jq -nc --arg id "$ADDON_ID" --arg uuid "$UUID" '{($id): $uuid}')
CAPS=$(jq -nc --arg uuids "$UUIDS" '{capabilities: {alwaysMatch: {browserName: "firefox", "moz:firefoxOptions": {args: ["-headless"], prefs: {"extensions.webextensions.uuids": $uuids}}}}}')
call POST /session "$CAPS"
ok creating the session
S=$(jq -r .value.sessionId "$OUT")

say "install dist/firefox-e2e as a temporary add-on"
call POST "/session/$S/moz/addon/install" "$(jq -nc --arg p "$EXT" '{path: $p, temporary: true}')"
ok installing the add-on
INSTALLED=$(jq -r .value "$OUT")
echo "add-on id: $INSTALLED"
[ "$INSTALLED" = "$ADDON_ID" ] || fail "unexpected add-on id: $INSTALLED"

say "open the fixture page"
call POST "/session/$S/url" "{\"url\":\"$PAGE\"}"
ok opening the page
call GET "/session/$S/window"
ok reading the window handle
PAGE_HANDLE=$(jq -r .value "$OUT")

# panel: switch to the panel tab and into its frame.
panel() {
    call POST "/session/$S/window" "{\"handle\":\"$PANEL_HANDLE\"}"
    ok switching to the panel tab
    call POST "/session/$S/frame" '{"id":0}'
    ok switching into the panel frame
}

say "open the panel page, in a frame of another tab"
call POST "/session/$S/window/new" '{"type":"tab"}'
ok opening a tab
PANEL_HANDLE=$(jq -r .value.handle "$OUT")
call POST "/session/$S/window" "{\"handle\":\"$PANEL_HANDLE\"}"
ok switching to the new tab
call POST "/session/$S/url" '{"url":"http://127.0.0.1:8000/host.html"}'
ok opening the host page
sleep 1
panel

say "ping: the background script is running"
PING=$(send "$S" "{ v: 1, type: 'core/ping' }")
echo "ping: $PING"
printf '%s\n' "$PING" | jq -e '.ok == true and .browser == "firefox"' >/dev/null || fail "the background did not answer the ping as Firefox: $PING"

say "find the tab of the fixture page"
# A page frame of an extension has no tabs API, and WebDriver's window handles are not
# tab ids, so the fixture tab is found by trying small ids: the start is accepted for
# the tab whose first step is the fixture page's address.
say "start recording the fixture tab"
PAGE_TAB=
for id in 1 2 3 4 5 6 7 8; do
    STARTED=$(send "$S" "{ v: 1, type: 'recorder/start', tabId: $id }")
    if printf '%s\n' "$STARTED" | jq -e --arg u "$PAGE" '.ok == true and .active == true and (.steps[0].url == $u)' >/dev/null; then
        PAGE_TAB=$id
        break
    fi
    send "$S" "{ v: 1, type: 'recorder/stop' }" >/dev/null
done
[ -n "$PAGE_TAB" ] || fail "the recorder did not start on any tab showing $PAGE"
echo "fixture tab: $PAGE_TAB"
printf 'start: %s\n' "$STARTED" | cut -c1-400

say "use the page: type in the field, press Go"
call POST "/session/$S/window" "{\"handle\":\"$PAGE_HANDLE\"}"
ok switching back to the page
call POST "/session/$S/element" '{"using":"css selector","value":"#q"}'
ok finding the field
Q=$(jq -r ".value[\"$ELEMENT\"]" "$OUT")
call POST "/session/$S/element/$Q/click" '{}'
ok clicking the field
call POST "/session/$S/element/$Q/value" '{"text":"hello"}'
ok typing
call POST "/session/$S/element" '{"using":"css selector","value":"#go"}'
ok finding the button
GO=$(jq -r ".value[\"$ELEMENT\"]" "$OUT")
call POST "/session/$S/element/$GO/click" '{}'
ok clicking the button
sleep 1.5

say "the recording"
panel
STATE=$(send "$S" "{ v: 1, type: 'recorder/state' }")
printf '%s\n' "$STATE" | jq -c '{active, warning, steps: [.steps[] | {type, selector: (.target.selectors[0].value // null), value, url}]}'
printf '%s\n' "$STATE" | jq -e '[.steps[].type] | (index("click") != null) and (index("change") != null) and (index("navigate") != null)' >/dev/null \
    || fail "the recording lacks a navigate, a change and a click"

say "export as a pure CDP test"
EXPORT=$(send "$S" "{ v: 1, type: 'recorder/export', format: 'cdp', name: 'firefox flow', entry: 'test' }")
printf '%s\n' "$EXPORT" | jq -r .text
printf '%s\n' "$EXPORT" | jq -e '.text | contains("page.locator(\"[data-test=\\\"go\\\"]\").click().await?;")' >/dev/null || fail "the export lacks the click"

say "stop"
STOPPED=$(send "$S" "{ v: 1, type: 'recorder/stop' }")
printf '%s\n' "$STOPPED" | jq -e '.ok == true and .active == false' >/dev/null || fail "stop failed: $STOPPED"

call DELETE "/session/$S"
printf '\nAll checks passed.\n'
