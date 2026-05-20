declare module 'png-chunk-text' {
  interface PNGtextChunk {
    keyword: string;
    text: string;
  }
  const PNGtext: {
    encode(keyword: string, text: string): { name: string; data: Uint8Array };
    decode(data: Uint8Array): PNGtextChunk;
  };
  export default PNGtext;
}

declare module 'png-chunks-extract' {
  interface PNGChunk {
    name: string;
    data: Uint8Array;
  }
  function extract(data: Uint8Array): PNGChunk[];
  export default extract;
}
