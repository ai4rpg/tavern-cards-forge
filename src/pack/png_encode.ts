import { crc32 } from 'crc';
import PNGtext from 'png-chunk-text';
import extract from 'png-chunks-extract';

export function encodePng(chunks: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const uint8 = new Uint8Array(4);
  const int32 = new Int32Array(uint8.buffer);
  const uint32 = new Uint32Array(uint8.buffer);

  let totalSize = 8;
  for (const chunk of chunks) {
    totalSize += chunk.data.length + 12;
  }

  const output = new Uint8Array(totalSize);

  output[0] = 0x89; output[1] = 0x50; output[2] = 0x4e; output[3] = 0x47;
  output[4] = 0x0d; output[5] = 0x0a; output[6] = 0x1a; output[7] = 0x0a;

  let idx = 8;
  for (const { name, data } of chunks) {
    const size = data.length;
    const nameChars = [name.charCodeAt(0), name.charCodeAt(1), name.charCodeAt(2), name.charCodeAt(3)];

    uint32[0] = size;
    output[idx++] = uint8[3]; output[idx++] = uint8[2];
    output[idx++] = uint8[1]; output[idx++] = uint8[0];

    output[idx++] = nameChars[0]; output[idx++] = nameChars[1];
    output[idx++] = nameChars[2]; output[idx++] = nameChars[3];

    for (let j = 0; j < size;) {
      output[idx++] = data[j++];
    }

    const crc = crc32(Buffer.from(data), crc32(Buffer.from(nameChars)));
    int32[0] = crc;
    output[idx++] = uint8[3]; output[idx++] = uint8[2];
    output[idx++] = uint8[1]; output[idx++] = uint8[0];
  }

  return output;
}

export function writePng(image: Buffer, jsonData: string): Buffer {
  const chunks = extract(new Uint8Array(image));

  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].name === 'tEXt') {
      const decoded = PNGtext.decode(chunks[i].data);
      const keyword = decoded.keyword.toLowerCase();
      if (keyword === 'chara' || keyword === 'ccv3') {
        chunks.splice(i, 1);
      }
    }
  }

  const base64V2 = Buffer.from(jsonData, 'utf-8').toString('base64');
  chunks.splice(-1, 0, PNGtext.encode('chara', base64V2));

  try {
    const v3Data = JSON.parse(jsonData);
    v3Data.spec = 'chara_card_v3';
    v3Data.spec_version = '3.0';
    const base64V3 = Buffer.from(JSON.stringify(v3Data), 'utf-8').toString('base64');
    chunks.splice(-1, 0, PNGtext.encode('ccv3', base64V3));
  } catch {}

  return Buffer.from(encodePng(chunks));
}

export function extractCharaFromPng(image: Buffer): string | null {
  const chunks = extract(new Uint8Array(image));
  for (const chunk of chunks) {
    if (chunk.name === 'tEXt') {
      const decoded = PNGtext.decode(chunk.data);
      if (decoded.keyword === 'chara' || decoded.keyword === 'ccv3') {
        return Buffer.from(decoded.text, 'base64').toString('utf-8');
      }
    }
  }
  return null;
}

export function stripCharaChunks(image: Buffer): Buffer {
  const chunks = extract(new Uint8Array(image));
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].name === 'tEXt') {
      const decoded = PNGtext.decode(chunks[i].data);
      const keyword = decoded.keyword.toLowerCase();
      if (keyword === 'chara' || keyword === 'ccv3') {
        chunks.splice(i, 1);
      }
    }
  }
  return Buffer.from(encodePng(chunks));
}
