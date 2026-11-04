// 颜色主题：一键同时设置「参数颜色 + 品牌字标颜色 + 边框底色」。
export interface ColorTheme {
  id: string;
  name: string;
  /** 相机/镜头、曝光、日期三行文字颜色。 */
  paramColor: string;
  /** 品牌字标颜色。 */
  brandColor: string;
  /** 边框底色。 */
  background: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'classic-paper',
    name: '经典纸白',
    paramColor: '#5f5a52',
    brandColor: '#141414',
    background: '#f6f3ec',
  },
  {
    id: 'pure-black',
    name: '纯黑',
    paramColor: '#c9c3b7',
    brandColor: '#f1ede3',
    background: '#080808',
  },
  {
    id: 'leica-red',
    name: '徕卡红',
    paramColor: '#5c574f',
    brandColor: '#c8102e',
    background: '#f6f3ec',
  },
  {
    id: 'sony-orange',
    name: '索尼橙',
    paramColor: '#b8b2a7',
    brandColor: '#f47b20',
    background: '#080808',
  },
  {
    id: 'nikon-yellow',
    name: '尼康黄',
    paramColor: '#c0bbb0',
    brandColor: '#ffd100',
    background: '#050505',
  },
  {
    id: 'fuji-green',
    name: '富士绿',
    paramColor: '#b8b2a6',
    brandColor: '#2ea36b',
    background: '#0a0a0a',
  },
  {
    id: 'xiaomi-warm',
    name: '小米暖白',
    paramColor: '#777777',
    brandColor: '#ff6900',
    background: '#fafafa',
  },
  {
    id: 'hasselblad-sand',
    name: '哈苏米',
    paramColor: '#b9b3a7',
    brandColor: '#ded7c6',
    background: '#060606',
  },
  {
    id: 'midnight-blue',
    name: '午夜蓝',
    paramColor: '#9fb0c2',
    brandColor: '#6f9bd1',
    background: '#0e141b',
  },
];
