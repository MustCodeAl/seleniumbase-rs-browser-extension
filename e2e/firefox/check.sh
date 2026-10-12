#!/bin/sh
# Loads dist/firefox-e2e into a real Firefox as a temporary add-on (through
# geckodriver's moz/addon/install, which BaseCase::install_addon sends) and checks
# that the background runs, that the recorder starts and that it records a click
# and typing on a page.
#
# It runs inside the image of seleniumbase-rs's docker/firefox-check (firefox-esr
# and geckodriver, nothing of this project), with the build mounted read-only:
#
#   docker build --no-slim -t sbrs-firefox-check /path/to/seleniumbase-rs/docker/firefox-check
#   docker run --rm --shm-size 512m \
#     -v "$PWD/dist/firefox-e2e:/ext:ro" -v "$PWD/e2e/firefox/check.sh:/check.sh:ro" \
#     sbrs-firefox-check /bin/sh /check.sh
#   docker rmi sbrs-firefox-check
#
# The panel page (the popup's page) is opened as a tab at a moz-extension:// address
# whose uuid is fixed by a preference, and the messages the popup's buttons send are
# sent from it. A headless Firefox has no toolbar to click.
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
geckodriver --version | head -n 1
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

say "open the panel page in another tab"
call POST "/session/$S/window/new" '{"type":"tab"}'
ok opening a tab
PANEL_HANDLE=$(jq -r .value.handle "$OUT")
call POST "/session/$S/window" "{\"handle\":\"$PANEL_HANDLE\"}"
ok switching to the new tab
call POST "/session/$S/url" "{\"url\":\"moz-extension://$UUID/ui/panel.html\"}"
ok opening the panel page

say "ping: the background script is running"
PING=$(send "$S" "{ v: 1, type: 'core/ping' }")
echo "ping: $PING"
echo "$PING" | jq -e '.ok == true and .browser == "firefox"' >/dev/null || fail "the background did not answer the ping as Firefox: $PING"

say "find the tab of the fixture page"
OWN=$(run "$S" "const done = arguments[arguments.length - 1]; browser.tabs.getCurrent().then((t) => done(t.id));")
PAGE_TAB=$(run "$S" "const done = arguments[arguments.length - 1]; browser.tabs.query({}).then((tabs) => done((tabs.find((t) => t.id !== $OWN) || {}).id));")
echo "panel tab: $OWN, fixture tab: $PAGE_TAB"
[ "$PAGE_TAB" != null ] || fail "the fixture tab was not found"

say "start recording the fixture tab"
STARTED=$(send "$S" "{ v: 1, type: 'recorder/start', tabId: $PAGE_TAB }")
echo "start: $STARTED"
echo "$STARTED" | jq -e '.ok == true and .active == true' >/dev/null || fail "the recorder did not start: $STARTED"

say "use the page: type in the field, press Go"
call POST "/session/$S/window" "{\"handle\":\"$PAGE_HANDLE\"}"
ok switching back to the page
call POST "/session/$S/element" '{"using":"css selector","value":"#q"}'
ok finding the field
Q=$(jq -r ".value[\"$ELEMENT\"]" "$OUT")
call POST "/session/$S/element/$Q/click"
ok clicking the field
call POST "/session/$S/element/$Q/value" '{"text":"hello"}'
ok typing
call POST "/session/$S/element" '{"using":"css selector","value":"#go"}'
ok finding the button
GO=$(jq -r ".value[\"$ELEMENT\"]" "$OUT")
call POST "/session/$S/element/$GO/click"
ok clicking the button
sleep 1.5

say "the recording"
call POST "/session/$S/window" "{\"handle\":\"$PANEL_HANDLE\"}"
ok switching to the panel tab
STATE=$(send "$S" "{ v: 1, type: 'recorder/state' }")
echo "$STATE" | jq -c '{active, warning, steps: [.steps[] | {type, selector: (.target.selectors[0].value // null), value, url}]}'
echo "$STATE" | jq -e '[.steps[].type] | (index("click") != null) and (index("change") != null) and (index("navigate") != null)' >/dev/null \
    || fail "the recording lacks a navigate, a change and a click"

say "export as a pure CDP test"
EXPORT=$(send "$S" "{ v: 1, type: 'recorder/export', format: 'cdp', name: 'firefox flow', entry: 'test' }")
echo "$EXPORT" | jq -r .text
echo "$EXPORT" | jq -e '.text | contains("page.locator(\"[data-test=\\\"go\\\"]\").click().await?;")' >/dev/null || fail "the export lacks the click"

say "stop"
STOPPED=$(send "$S" "{ v: 1, type: 'recorder/stop' }")
echo "$STOPPED" | jq -e '.ok == true and .active == false' >/dev/null || fail "stop failed: $STOPPED"

call DELETE "/session/$S"
printf '\nAll checks passed.\n'
