export function customFontAlias(id: string) {
  return `OpenFrameFont_${id.replaceAll('-', '')}`;
}

export const systemFonts = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Courier New',
  'Impact',
  'Roboto',
] as const;

export type CustomFont = {
  id: string;
  family: string;
  format: 'woff2' | 'woff' | 'ttf' | 'otf';
  bytes: number;
  url: string;
};
