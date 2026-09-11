/**
 * subs-test.js — offline test of the v1.0.74 subtitle module in docs/kp.js.
 *
 *   node subs-test.js
 *
 * Boots kp.js in a stubbed Lampa/jQuery environment, exposes the private
 * helpers through a text patch (no production code changes), and checks:
 *   1. URL resolution (relative / root-relative / protocol-relative / abs)
 *   2. Real kinopub HLS4 master (from logs/) → subtitle renditions
 *   3. Rendition playlist parsing (#EXTINF segments, relative segment URIs)
 *   4. WebVTT segment parsing incl. overlapping cues between segments,
 *      X-TIMESTAMP-MAP handling, VTT styling tags, SRT fallback
 *   5. Proxy buildReducedMaster with subs=1 (absolutized URIs)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

// ── 1. Stub environment ───────────────────────────────────────────────────
const storage = {};
const noop = function () {};
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'length' ? 0 : chain()),
  apply: () => chain()
});
global.window    = global;
global.addEventListener = noop;
global.MutationObserver = function () { this.observe = noop; this.disconnect = noop; };
global.document  = { addEventListener: noop, querySelector: () => null };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36 Chrome/120.0.6099.5 TV Safari/537.36' }, configurable: true });
global.$ = () => chain();
global.XMLHttpRequest = function () { this.open = noop; this.send = noop; this.setRequestHeader = noop; };
function Reguest() { this.timeout = noop; this.silent = noop; this.clear = noop; this.native = noop; }
global.Lampa = {
  Manifest: { app_digital: 333, app_version: '3.3.3', plugins: null },
  Storage:  { get: (k, d) => (k in storage ? storage[k] : d), set: (k, v) => { storage[k] = v; }, field: (k) => storage[k], cache: (k, n, d) => d, sync: noop },
  Utils:    { uid: () => 'testsess' },
  Platform: { is: (n) => n === 'tizen', get: () => 'tizen' },
  Lang:     { add: noop, translate: (s) => s },
  Template: { add: noop, get: () => chain() },
  Listener: { follow: noop },
  Player:   { listener: { follow: noop }, playdata: () => null },
  PlayerVideo: { listener: { follow: noop, send: noop }, url: noop, video: () => null, subsview: noop },
  PlayerPanel: { updateTranslate: noop },
  SettingsApi: { addComponent: noop, addParam: noop },
  Component: { add: noop },
  Reguest,
  Noty: { show: noop },
  Modal: { open: noop, close: noop },
  Controller: { enabled: () => ({ name: 'x' }), toggle: noop }
};

// ── 2. Load kp.js with a test-export patch ────────────────────────────────
let src = fs.readFileSync(path.join(__dirname, 'docs', 'kp.js'), 'utf8');
const tail = '  startPlugin();\n\n})();';
assert(src.endsWith(tail + '\n') || src.endsWith(tail), 'kp.js tail changed — update subs-test.js');
src = src.replace(tail,
  '  startPlugin();\n  window.__kpTest = { kpResolveUrl, parseHls4Master, kpExtractHlsSubs, KpSubs, kpSubLabel, kpBuildSubItems, kpSubsModeResolved };\n})();');
new Function(src)();
const T = global.__kpTest;
assert(T, 'plugin did not boot (early return?)');

let passed = 0;
function ok(cond, msg) { assert(cond, msg); passed++; }

// ── 3. URL resolution ─────────────────────────────────────────────────────
const master = 'https://cdn2cdn.com/hls4/TOKEN/989569.m3u8?loc=nl';
ok(T.kpResolveUrl(master, '/hls/TOKEN/subtitles/5/4f/1512706.srt/index.m3u8?loc=nl') ===
   'https://cdn2cdn.com/hls/TOKEN/subtitles/5/4f/1512706.srt/index.m3u8?loc=nl', 'root-relative');
ok(T.kpResolveUrl(master, 'seg-1.vtt?loc=nl') === 'https://cdn2cdn.com/hls4/TOKEN/seg-1.vtt?loc=nl', 'relative sibling');
ok(T.kpResolveUrl('https://h/a/b/c/index.m3u8?x=1', '../d/seg.vtt') === 'https://h/a/b/d/seg.vtt', 'dot-dot');
ok(T.kpResolveUrl('https://h/a/b/index.m3u8', './seg.vtt') === 'https://h/a/b/seg.vtt', 'dot');
ok(T.kpResolveUrl(master, '//other.cdn/x.m3u8') === 'https://other.cdn/x.m3u8', 'protocol-relative');
ok(T.kpResolveUrl(master, 'https://abs.cdn/x.m3u8') === 'https://abs.cdn/x.m3u8', 'absolute untouched');
ok(T.kpResolveUrl('https://h/a/index.m3u8', '../../../up.vtt') === 'https://h/up.vtt', 'dot-dot clamp at root');

// ── 4. Real master from TV logs ───────────────────────────────────────────
const logFile = path.join(__dirname, 'logs', '182320.834.txt');
const logTxt  = fs.readFileSync(logFile, 'utf8');
const m = logTxt.match(/\[manifest\] master\.m3u8 (\{.*)/);
const rec = JSON.parse(m[1]);
const masterText = rec.keep.join('\n') + '\n';
const ex = T.kpExtractHlsSubs(rec.url, masterText);
ok(ex.list.length === 7, 'real master: 7 subtitle renditions, got ' + ex.list.length);
ok(ex.audioRenditions === 48, 'real master: 48 audio renditions (12x4), got ' + ex.audioRenditions);
ok(ex.list[0].uri.indexOf('https://cdn2cdn.com/hls/') === 0, 'rendition URI absolutized against master host');
ok(ex.list[0].uri.indexOf('index.m3u8?loc=nl') > 0, 'query string preserved');
ok(ex.list[0].name === 'RUS #01' && ex.list[0].lang === 'rus', 'name/lang parsed');
ok(T.kpSubLabel(ex.list[0], 0) === 'Русские 01', 'label ru: ' + T.kpSubLabel(ex.list[0], 0));
ok(T.kpSubLabel(ex.list[6], 6) === 'Английские 07', 'label eng #07: ' + T.kpSubLabel(ex.list[6], 6));
storage.language = 'en';
ok(T.kpSubLabel(ex.list[1], 1) === 'JPN 02', 'label en: ' + T.kpSubLabel(ex.list[1], 1));
storage.language = 'ru';

// ── 5. Rendition playlist ─────────────────────────────────────────────────
const plUrl = ex.list[0].uri;
const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
  '#EXTINF:10.000,\nseg-1.vtt?loc=nl\n#EXTINF:10.000,\nseg-2.vtt?loc=nl\n#EXTINF:4.500,\nseg-3.vtt?loc=nl\n#EXT-X-ENDLIST\n';
const segs = T.KpSubs.parsePlaylist(playlist, plUrl);
ok(segs.length === 3, 'three segments');
ok(segs[1].start === 10 && segs[2].start === 20 && segs[2].dur === 4.5, 'segment timeline');
ok(segs[0].url.indexOf('/subtitles/5/4f/1512706.srt/seg-1.vtt?loc=nl') > 0, 'segment URI relative to playlist dir: ' + segs[0].url);

// ── 6. WebVTT segments ────────────────────────────────────────────────────
const seg1 = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello <i>world</i>\n\n00:00:09.500 --> 00:00:11.000 line:90% align:center\n<c.yellow>Boundary</c> cue\n';
const seg2 = 'WEBVTT\n\n00:00:09.500 --> 00:00:11.000\nBoundary cue\n\n00:00:12.000 --> 00:00:14.000\nSecond\nline\n';
const r1 = T.KpSubs.parseCues(seg1, segs[0]);
ok(r1.strategy === 'raw' && r1.cues.length === 2, 'seg1 raw absolute times, 2 cues');
ok(r1.cues[0].t === 'Hello <i>world</i>', 'keeps <i>, got: ' + r1.cues[0].t);
ok(r1.cues[1].t === 'Boundary cue', 'strips <c> tags: ' + r1.cues[1].t);
const r2 = T.KpSubs.parseCues(seg2, segs[1]);
ok(r2.strategy === 'raw' && r2.cues[1].t === 'Second<br>line', 'multi-line → <br>');
// overlapping cue dedupe happens in merge(); emulate through select() path is async — check key equality instead
ok(r1.cues[1].s === r2.cues[0].s && r1.cues[1].t === r2.cues[0].t, 'boundary cue identical across segments (dedupe key matches)');
// X-TIMESTAMP-MAP: local 0 ↔ MPEGTS 900000 (10s) with relative cue times
const seg3 = 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1800000\n\n00:00:01.000 --> 00:00:02.000\nMapped\n';
const r3 = T.KpSubs.parseCues(seg3, { start: 20, dur: 10 });
ok(r3.strategy === 'tsmap' && Math.abs(r3.cues[0].s - 21) < 0.001, 'tsmap applied: ' + r3.strategy + ' ' + r3.cues[0].s);
// relative-to-segment times without a map
const r4 = T.KpSubs.parseCues('WEBVTT\n\n00:01.000 --> 00:02.000\nRel\n', { start: 100, dur: 10 });
ok(r4.strategy === 'relative' && r4.cues[0].s === 101, 'relative strategy: ' + r4.strategy + ' ' + r4.cues[0].s);
// SRT direct file
const srt = '1\n00:00:05,000 --> 00:00:06,000\nSrt one\n\n2\n00:00:07,000 --> 00:00:08,000\n{\\an8}Top\n';
const r5 = T.KpSubs.parseCues(srt, null);
ok(r5.cues.length === 2 && r5.cues[0].s === 5 && r5.cues[1].t === 'Top', 'srt parsed');

// ── 7. Items handed to Lampa ──────────────────────────────────────────────
const items = T.kpBuildSubItems(ex.list, [{ label: 'api', url: 'https://x/a.srt' }]);
ok(items.length === 7 && items[0].ready === true && typeof items[0].kp_src.uri === 'string', 'items built from HLS list');
ok(Object.keys(items[0]).indexOf('mode') === -1, 'mode accessor non-enumerable (safe for JSON clone)');
ok(items[0].mode === 'disabled', 'mode getter');
const apiOnly = T.kpBuildSubItems([], [{ label: 'api', url: 'https://x/a.srt' }]);
ok(apiOnly.length === 1 && apiOnly[0].kp_src.uri === 'https://x/a.srt', 'API fallback when HLS empty');
ok(T.kpSubsModeResolved() === 'hls', 'default mode resolves to hls');
storage.kp_subs_mode = 'native';
ok(T.kpSubsModeResolved() === 'hls', 'native without proxy 1.2 falls back to hls');
storage.kp_subs_mode = 'api';
ok(T.kpSubsModeResolved() === 'api', 'api mode kept');

// ── 8. Proxy: subs pass-through ───────────────────────────────────────────
let psrc = fs.readFileSync(path.join(__dirname, 'proxy-server', 'server.js'), 'utf8');
psrc = psrc.replace(/const server = http\.createServer[\s\S]*$/, 'module.exports = { parseHls4Master, buildReducedMaster };');
const P = {}; new Function('module', 'require', 'process', psrc)(P, require, { env: {}, stdout: { write: noop }, stderr: { write: noop } });
const parsedP = P.exports.parseHls4Master(masterText);
const noSubs = P.exports.buildReducedMaster(parsedP, 5, {});
ok(noSubs.text.indexOf('TYPE=SUBTITLES') === -1 && noSubs.text.indexOf('SUBTITLES=') === -1, 'proxy default output has no subtitles (v1.1.6-compatible)');
ok(noSubs.pickedName.indexOf('05.') === 0, 'proxy picks voice 05');
const withSubs = P.exports.buildReducedMaster(parsedP, 5, { subs: true, masterUrl: rec.url });
ok(withSubs.subsCount === 7, 'proxy subs=1 keeps 7 renditions');
ok((withSubs.text.match(/TYPE=SUBTITLES/g) || []).length === 7, 'seven SUBTITLES lines');
ok(withSubs.text.indexOf('URI="https://cdn2cdn.com/hls/') > 0, 'proxy absolutized subtitle URIs');
ok(/AUDIO="aud",SUBTITLES="sub"/.test(withSubs.text), 'stream-inf references the sub group');
ok(withSubs.text.split('\n').length < 20, 'reduced master stays small: ' + withSubs.text.length + ' bytes');

console.log('subs-test: ' + passed + ' checks passed');
console.log('--- sample reduced master with subs=1 ---\n' + withSubs.text);
