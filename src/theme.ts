export type ThemeName = 'Campus Blue & Gold' | 'Mountain Morning' | 'Dark Study Mode' | 'Soft Academic' | 'Modern BYU Idaho' | 'Forest Focus' | 'Lavender Planner' | 'Paper Notebook';
export type ThemeColors = { ink: string; muted: string; line: string; page: string; white: string; violet: string; violetSoft: string; blue: string; blueSoft: string; green: string; greenSoft: string; amber: string; amberSoft: string; orange: string };

export const themes: Record<ThemeName, { colors: ThemeColors }> = {
  'Campus Blue & Gold': { colors: { ink: '#172b4d', muted: '#718096', line: '#e5e9f0', page: '#f6f8fb', white: '#ffffff', violet: '#2f5d9b', violetSoft: '#e6eef9', blue: '#4b83c4', blueSoft: '#e5f0fb', green: '#4d9b78', greenSoft: '#e4f4ec', amber: '#d4a044', amberSoft: '#fbf1da', orange: '#d27c55' } },
  'Mountain Morning': { colors: { ink: '#263746', muted: '#778993', line: '#dfe8e5', page: '#f5f8f6', white: '#ffffff', violet: '#527b86', violetSoft: '#e7f0f0', blue: '#6a9bb3', blueSoft: '#e7f2f6', green: '#6c9b7d', greenSoft: '#e6f2e9', amber: '#c99b5a', amberSoft: '#faf0dd', orange: '#c98268' } },
  'Dark Study Mode': { colors: { ink: '#f3edf7', muted: '#aaa0b6', line: '#40394b', page: '#1f1c28', white: '#2b2637', violet: '#b79ae8', violetSoft: '#403550', blue: '#8ca9e8', blueSoft: '#303b57', green: '#78c2a0', greenSoft: '#29463d', amber: '#e2b56d', amberSoft: '#4c3d2c', orange: '#e39a7b' } },
  'Soft Academic': { colors: { ink: '#3d2940', muted: '#897d8b', line: '#ebe3df', page: '#fbf8f3', white: '#fffdfb', violet: '#7b5576', violetSoft: '#f1e8ef', blue: '#6e88ad', blueSoft: '#e9eef5', green: '#6d9a87', greenSoft: '#e9f2ed', amber: '#c98c5c', amberSoft: '#f8ecdf', orange: '#c77b62' } },
  'Modern BYU Idaho': { colors: { ink: '#17324d', muted: '#6e8295', line: '#dce6ee', page: '#f4f8fb', white: '#ffffff', violet: '#1d628f', violetSoft: '#e3f0f7', blue: '#4b91bb', blueSoft: '#e4f2f8', green: '#4e9a7c', greenSoft: '#e5f4ed', amber: '#c7953e', amberSoft: '#fbf2dc', orange: '#d47852' } },
  'Forest Focus': { colors: { ink: '#263b32', muted: '#778b7e', line: '#dfe9e1', page: '#f4f8f3', white: '#ffffff', violet: '#557d69', violetSoft: '#e5f0e8', blue: '#668aa0', blueSoft: '#e7f0f4', green: '#39866b', greenSoft: '#e1f2e9', amber: '#c49a55', amberSoft: '#faf0dc', orange: '#c97b5e' } },
  'Lavender Planner': { colors: { ink: '#332b4b', muted: '#89829e', line: '#e7e2f1', page: '#f8f6fc', white: '#ffffff', violet: '#7967b5', violetSoft: '#eeeafd', blue: '#758fbe', blueSoft: '#e8eef9', green: '#6fa08f', greenSoft: '#e7f3ed', amber: '#c9a05f', amberSoft: '#fbf2df', orange: '#cc8297' } },
  'Paper Notebook': { colors: { ink: '#373536', muted: '#8e8885', line: '#e7e0d7', page: '#faf7ef', white: '#fffefa', violet: '#8d6572', violetSoft: '#f3e8eb', blue: '#66849b', blueSoft: '#e8f0f3', green: '#6f967b', greenSoft: '#e8f1e8', amber: '#c29358', amberSoft: '#faf0dd', orange: '#c77d5d' } },
};

function readSavedTheme(): ThemeName {
  try {
    const saved = typeof globalThis !== 'undefined' && 'localStorage' in globalThis ? globalThis.localStorage.getItem('localLearnTheme') : null;
    return saved && saved in themes ? saved as ThemeName : 'Soft Academic';
  } catch (_) { return 'Soft Academic'; }
}

export let activeTheme: ThemeName = readSavedTheme();
export const theme = { colors: { ...themes[activeTheme].colors }, radius: { card: 13, small: 9 } };

export function setTheme(name: ThemeName) {
  activeTheme = name;
  Object.assign(theme.colors, themes[name].colors);
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      globalThis.localStorage.setItem('localLearnTheme', name);
      globalThis.location?.reload();
    }
  } catch (_) { /* Native runtimes do not expose browser storage or reload. */ }
}
