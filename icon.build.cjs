const fs = require('fs');
const zlib = require('zlib');

const SRC = process.argv[2];
const OUT = process.argv[3];
const SIZE = Number(process.argv[4] || 256);

// ---- decode -------------------------------------------------------------
function decodePng(buf) {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
	const width = buf.readUInt32BE(16);
	const height = buf.readUInt32BE(20);
	const depth = buf[24];
	const colorType = buf[25];
	const interlace = buf[28];
	if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
	if (interlace !== 0) throw new Error('interlaced PNG not supported');

	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new Error(`unsupported color type ${colorType}`);

	// Concatenate every IDAT chunk before inflating: the zlib stream is split
	// across them at arbitrary boundaries.
	const parts = [];
	let off = 8;
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString('ascii', off + 4, off + 8);
		if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
		if (type === 'IEND') break;
		off += 12 + len;
	}
	const raw = zlib.inflateSync(Buffer.concat(parts));

	// ---- unfilter ---------------------------------------------------------
	const bpp = channels;
	const stride = width * bpp;
	const out = Buffer.alloc(height * stride);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[pos++];
		const line = raw.subarray(pos, pos + stride);
		pos += stride;
		const cur = out.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev ? prev[x] : 0;
			const c = prev && x >= bpp ? prev[x - bpp] : 0;
			let v = line[x];
			switch (filter) {
				case 0: break;
				case 1: v += a; break;
				case 2: v += b; break;
				case 3: v += (a + b) >> 1; break;
				case 4: {
					// Paeth: pick whichever neighbour the gradient predicts.
					const p = a + b - c;
					const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
					v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
					break;
				}
				default: throw new Error(`bad filter ${filter}`);
			}
			cur[x] = v & 0xff;
		}
	}
	return { width, height, channels, data: out };
}

// ---- box downscale, alpha-correct --------------------------------------
function resize(img, size) {
	const { width, height, channels, data } = img;
	const out = Buffer.alloc(size * size * 4);
	const sx = width / size;
	const sy = height / size;

	for (let y = 0; y < size; y++) {
		const y0 = Math.floor(y * sy), y1 = Math.min(height, Math.ceil((y + 1) * sy));
		for (let x = 0; x < size; x++) {
			const x0 = Math.floor(x * sx), x1 = Math.min(width, Math.ceil((x + 1) * sx));
			let r = 0, g = 0, b = 0, a = 0, n = 0;
			for (let yy = y0; yy < y1; yy++) {
				for (let xx = x0; xx < x1; xx++) {
					const i = (yy * width + xx) * channels;
					const alpha = channels === 4 ? data[i + 3] : 255;
					// Premultiply before averaging, or transparent pixels drag colour
					// toward black and leave a halo around the artwork.
					r += data[i] * alpha;
					g += data[i + 1] * alpha;
					b += data[i + 2] * alpha;
					a += alpha;
					n++;
				}
			}
			const o = (y * size + x) * 4;
			if (a > 0) {
				out[o] = Math.round(r / a);
				out[o + 1] = Math.round(g / a);
				out[o + 2] = Math.round(b / a);
			}
			out[o + 3] = Math.round(a / n);
		}
	}
	return out;
}

// ---- encode -------------------------------------------------------------
function crc32(buf) {
	let crc = 0xffffffff;
	for (let n = 0; n < buf.length; n++) {
		let c = (crc ^ buf[n]) & 0xff;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crc = c ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}
function encodePng(px, size) {
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0;
		px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const img = decodePng(fs.readFileSync(SRC));
console.log(`source ${img.width}x${img.height} ch=${img.channels}`);
fs.writeFileSync(OUT, encodePng(resize(img, SIZE), SIZE));
console.log(`wrote ${OUT} ${SIZE}x${SIZE} ${(fs.statSync(OUT).size / 1024).toFixed(1)}KB`);
