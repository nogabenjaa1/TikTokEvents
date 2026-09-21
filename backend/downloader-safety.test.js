const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseDownloadUrl, extraHostsFromEnv, friendlyDownloaderError, redactSecrets, checkDownloadCapacity,
    DownloadUrlError, DownloadLimitError,
} = require('./lib/downloaderSafety');

const rejects = (input, extra = []) => assert.throws(() => parseDownloadUrl(input, extra), DownloadUrlError, JSON.stringify(input));

test('accepts YouTube and TikTok links and returns the normalized URL', () => {
    assert.deepEqual(parseDownloadUrl('https://www.youtube.com/watch?v=abc123', []), { url: 'https://www.youtube.com/watch?v=abc123', tiktok: false });
    assert.deepEqual(parseDownloadUrl('https://youtu.be/abc123', []), { url: 'https://youtu.be/abc123', tiktok: false });
    assert.equal(parseDownloadUrl('https://m.youtube.com/shorts/xyz', []).tiktok, false);
    assert.equal(parseDownloadUrl('https://music.youtube.com/watch?v=1', []).tiktok, false);
    assert.equal(parseDownloadUrl('  https://youtu.be/x  ', []).url, 'https://youtu.be/x', 'surrounding spaces are trimmed');
    assert.equal(parseDownloadUrl('HTTPS://WWW.YOUTUBE.COM./watch?v=1', []).url, 'https://www.youtube.com./watch?v=1', 'the URL passed on is the normalized one');
    assert.equal(parseDownloadUrl('http://youtube.com/watch?v=1', []).tiktok, false, 'plain http is fine: the site redirects it');
});

test('TikTok links are flagged and lose their tracking query (it causes 403s)', () => {
    const tt = parseDownloadUrl('https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc#frag', []);
    assert.deepEqual(tt, { url: 'https://www.tiktok.com/@user/video/123', tiktok: true });
    assert.equal(parseDownloadUrl('https://vm.tiktok.com/ZMabc/', []).tiktok, true);
    assert.equal(parseDownloadUrl('https://vt.tiktok.com/ZSabc/', []).tiktok, true);
});

test('rejects anything that could be read as a yt-dlp option (argument injection)', () => {
    for (const evil of [
        '--exec=touch /tmp/x', '--exec', '-o /etc/passwd', '--config-locations=/etc', '-U',
        '--load-info-json=/etc/passwd', '--batch-file=/etc/hosts', '-', '--', '--proxy=http://evil',
    ]) rejects(evil);
});

test('rejects hosts that are not YouTube or TikTok, including the internal network (SSRF)', () => {
    for (const evil of [
        'http://localhost:3001/health', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/', 'http://10.0.0.5/admin', 'http://192.168.1.1/',
        'https://evil.com/youtube.com', 'https://evil.com/?u=https://youtube.com/watch?v=1',
        'https://youtube.com.evil.com/', 'https://notyoutube.com/watch', 'https://eviltiktok.com/',
        'https://youtube.com@evil.com/', 'https://youtub\u0435.com/watch', // "e" cirílica
    ]) rejects(evil);
});

test('rejects other schemes, credentials, unusual ports, spaces and non-text input', () => {
    for (const evil of [
        'file:///etc/passwd', 'javascript:alert(1)', 'ftp://youtube.com/x', 'data:text/html,hola',
        'https://user:pass@www.youtube.com/watch?v=1', 'https://www.youtube.com:8443/watch?v=1',
        'https://youtu.be/a b', 'https://youtu.be/a\nb', 'https://youtu.be/a\u0000b',
        '', '   ', undefined, null, 123, {}, ['https://youtu.be/x'],
        `https://youtu.be/${'a'.repeat(3000)}`,
    ]) rejects(evil);
});

test('the owner can allow more sites through the environment, and only well-formed domains count', () => {
    rejects('https://www.instagram.com/reel/x', []);
    assert.equal(parseDownloadUrl('https://www.instagram.com/reel/x', ['instagram.com']).tiktok, false);
    assert.deepEqual(extraHostsFromEnv('instagram.com, .x.com , bad host, ,-x, localhost'), ['instagram.com', 'x.com']);
    assert.deepEqual(extraHostsFromEnv(''), []);
    assert.deepEqual(extraHostsFromEnv(undefined), []);
});

test('the user only sees the ERROR line from yt-dlp, never the command line, the proxy or server paths', () => {
    const proxy = 'http://user:s3cret@proxy.example:8080';
    const raw = [
        'Error code: Error: Command failed: /opt/render/project/src/backend/bin/yt-dlp --proxy ' + proxy + ' -- https://www.tiktok.com/@a/video/1',
        '',
        'Stderr:',
        '\u001b[0;31mERROR:\u001b[0m [TikTok] 1: Unable to connect to proxy ' + proxy,
    ].join('\n');
    const shown = friendlyDownloaderError(raw, [proxy]);
    assert.ok(!shown.includes('s3cret'), shown);
    assert.ok(!shown.includes('proxy.example'), shown);
    assert.ok(!shown.includes('/opt/render'), shown);
    assert.ok(!shown.includes('Command failed'), shown);
    assert.match(shown, /Unable to connect to proxy \[oculto\]/);
});

test('credentials inside any URL and server paths are hidden even when the secret is not known', () => {
    assert.equal(friendlyDownloaderError('ERROR: cannot reach http://bob:hunter2@host.example/x'), 'cannot reach http://[oculto]@host.example/x');
    assert.equal(friendlyDownloaderError('ERROR: unable to write /opt/render/project/src/backend/downloads/x.mp4 now'), 'unable to write [ruta] now');
    assert.equal(friendlyDownloaderError('ERROR: unable to write C:\\Users\\Benja\\x.mp4 now'), 'unable to write [ruta] now');
    assert.equal(friendlyDownloaderError('ERROR: Video unavailable'), 'Video unavailable');
});

test('without an ERROR line the user gets a generic message, and long errors are cut', () => {
    assert.equal(friendlyDownloaderError('Error code: Error: spawn ENOENT /opt/render/bin/yt-dlp --proxy http://a:b@c'), 'No se pudo procesar el enlace.');
    assert.equal(friendlyDownloaderError(undefined), 'No se pudo procesar el enlace.');
    assert.equal(friendlyDownloaderError('', [], 'otro'), 'otro');
    assert.ok(friendlyDownloaderError('ERROR: ' + 'x'.repeat(1000)).length <= 220);
});

test('redactSecrets hides known secrets, credentials in URLs and terminal colors for the server log', () => {
    assert.equal(redactSecrets('use \u001b[31mhttp://u:p@h\u001b[0m and TOKEN123', ['TOKEN123']), 'use http://[oculto]@h and [oculto]');
    assert.equal(redactSecrets('nada', ['ab']), 'nada', 'a secret too short to be one is ignored, so it does not mangle the text');
    assert.equal(redactSecrets(null), '');
});

test('the download caps stop a license and the whole server from piling up jobs', () => {
    const caps = { perLicense: 2, total: 6 };
    assert.doesNotThrow(() => checkDownloadCapacity(1, 5, caps));
    assert.throws(() => checkDownloadCapacity(2, 3, caps), (err) => err instanceof DownloadLimitError && err.status === 429 && /2 descargas en curso/.test(err.message));
    assert.throws(() => checkDownloadCapacity(1, 6, caps), (err) => err instanceof DownloadLimitError && /muy ocupado/.test(err.message));
    const single = { perLicense: 1, total: 6 };
    assert.throws(() => checkDownloadCapacity(1, 1, single), /Ya tienes 1 descarga en curso\. Espera a que termine para iniciar otra\./);
});
