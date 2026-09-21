const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffMedia } = require('./lib/mediaSniff');

// The headers below are the first bytes of real files made by ffmpeg, yt-dlp and the project's own images:
// the check must accept everything a streamer really uploads and nothing that only claims to be media.
const hex = (text) => Buffer.from(text.replace(/\s+/g, ''), 'hex');
const padded = (head, size = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x41)]);

const REAL = {
    png: ['89504e470d0a1a0a0000000d', 'image', 'image/png', '.png'],
    jpeg: ['ffd8ffe000104a4649460001', 'image', 'image/jpeg', '.jpg'],
    gif: ['47494638396140004000f71f', 'gif', 'image/gif', '.gif'],
    webp: ['524946462a03000057454250', 'image', 'image/webp', '.webp'],
    mp4: ['000000206674797069736f6d', 'video', 'video/mp4', '.mp4'],
    webm: ['1a45dfa39f4286810142f781', 'video', 'video/webm', '.webm'],
    mp3: ['494433040000000000235453', 'audio', 'audio/mpeg', '.mp3'],
    wav: ['52494646ce58010057415645', 'audio', 'audio/wav', '.wav'],
    ogg: ['4f6767530002000000000000', 'audio', 'audio/ogg', '.ogg'],
};

test('recognizes every allowed format from the real first bytes of a file', () => {
    for (const [kind, [head, group, mime, ext]] of Object.entries(REAL)) {
        assert.deepEqual(sniffMedia(padded(hex(head))), { kind, group, mime, ext }, kind);
    }
});

test('recognizes the other valid shapes of the same formats', () => {
    assert.equal(sniffMedia(padded(hex('47494638376140004000f71f'))).kind, 'gif', 'GIF87a');
    assert.equal(sniffMedia(padded(hex('fffb50c400000a2c432e5594'))).kind, 'mp3', 'mp3 without an ID3 tag starts at the audio frame');
    assert.equal(sniffMedia(padded(hex('fff350c400000a2c432e5594'))).kind, 'mp3', 'MPEG-2 layer III frame');
    assert.equal(sniffMedia(padded(hex('000000246674797069736f6d'))).kind, 'mp4', 'fragmented mp4');
    assert.equal(sniffMedia(padded(hex('0000001c667479704d534e56'))).kind, 'mp4', 'ftyp with another brand');
    assert.equal(sniffMedia(padded(hex('000000086d6f6f760000006c'))).kind, 'mp4', 'a file that starts with the moov box');
});

test('does not accept a file just because it says it is an image or a sound', () => {
    const nope = {
        html: Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>'),
        svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="5"/></svg>'),
        exe: padded(hex('4d5a90000300000004000000ffff0000')),
        zip: padded(hex('504b0304140000000800')),
        pdf: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj'),
        elf: padded(hex('7f454c4602010100000000000000')),
        text: Buffer.from('esto es solo texto que dice ser un png'),
        zeros: Buffer.alloc(64),
        riffOther: padded(hex('52494646ce58010041564920')), // RIFF AVI: not WAVE or WEBP
        oggLookalike: padded(hex('4f6767')), // "Ogg" without the final S
        pngNoTail: padded(hex('89504e47')), // PNG signature cut short
        mp3NoLayer: padded(hex('fff000c400000a2c432e5594')), // sync bits but the reserved layer 00 (that is AAC, not MP3)
    };
    for (const [name, buffer] of Object.entries(nope)) assert.equal(sniffMedia(buffer), null, name);
});

test('handles empty, tiny and non-buffer input without throwing', () => {
    for (const bad of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.alloc(11, 0xff), undefined, null, 'GIF89a......', 123, {}, []]) {
        assert.equal(sniffMedia(bad), null, String(bad));
    }
});

test('the kind comes from the bytes, not from anything else: a PNG stays a PNG whatever it is called', () => {
    const png = padded(hex(REAL.png[0]));
    assert.equal(sniffMedia(png).group, 'image');
    assert.equal(sniffMedia(png).ext, '.png');
});

test('a script hidden after a valid header is still just an image, and it is stored as one', () => {
    const polyglot = Buffer.concat([Buffer.from('GIF89a'), hex('40004000f71f'), Buffer.from('<script>alert(1)</script>')]);
    const media = sniffMedia(polyglot);
    assert.deepEqual([media.mime, media.ext], ['image/gif', '.gif'], 'it is published as image/gif, which the browser never runs as HTML');
});
