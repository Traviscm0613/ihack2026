export type ThemeName = 'Campus Blue & Gold' | 'Mountain Morning' | 'Dark Study Mode' | 'Soft Academic' | 'Modern BYU Idaho' | 'Forest Focus' | 'Lavender Planner' | 'Paper Notebook';
export type ThemeColors = { ink: string; muted: string; line: string; page: string; white: string; violet: string; violetSoft: string; blue: string; blueSoft: string; green: string; greenSoft: string; amber: string; amberSoft: string; orange: string };

export const themes: Record<ThemeName, { colors: ThemeColors }> = {
  'Campus Blue & Gold': { colors: { ink: '#172b4d', muted: '#718096', line: '#d8e2ee', page: '#f1f6fb', white: '#ffffffcc', violet: '#2f5d9b', violetSoft: '#e6eef9cc', blue: '#4b83c4', blueSoft: '#e5f0fbcc', green: '#4d9b78', greenSoft: '#e4f4eccc', amber: '#d4a044', amberSoft: '#fbf1dacc', orange: '#d27c55' } },
  'Mountain Morning': { colors: { ink: '#263746', muted: '#778993', line: '#d4e3df', page: '#eef7f5', white: '#ffffffcc', violet: '#527b86', violetSoft: '#e7f0f0cc', blue: '#6a9bb3', blueSoft: '#e7f2f6cc', green: '#6c9b7d', greenSoft: '#e6f2e9cc', amber: '#c99b5a', amberSoft: '#faf0ddcc', orange: '#c98268' } },
  'Dark Study Mode': { colors: { ink: '#f3edf7', muted: '#aaa0b6', line: '#51465e', page: '#17141f', white: '#2b2637dd', violet: '#b79ae8', violetSoft: '#403550cc', blue: '#8ca9e8', blueSoft: '#303b57cc', green: '#78c2a0', greenSoft: '#29463dcc', amber: '#e2b56d', amberSoft: '#4c3d2ccc', orange: '#e39a7b' } },
  'Soft Academic': { colors: { ink: '#3d2940', muted: '#897d8b', line: '#e5d8df', page: '#faf5f8', white: '#fffdfbcc', violet: '#7b5576', violetSoft: '#f1e8efcc', blue: '#6e88ad', blueSoft: '#e9eef5cc', green: '#6d9a87', greenSoft: '#e9f2edcc', amber: '#c98c5c', amberSoft: '#f8ecdfcc', orange: '#c77b62' } },
  'Modern BYU Idaho': { colors: { ink: '#17324d', muted: '#6e8295', line: '#cfdee8', page: '#eef7fb', white: '#ffffffcc', violet: '#1d628f', violetSoft: '#e3f0f7cc', blue: '#4b91bb', blueSoft: '#e4f2f8cc', green: '#4e9a7c', greenSoft: '#e5f4edcc', amber: '#c7953e', amberSoft: '#fbf2dccc', orange: '#d47852' } },
  'Forest Focus': { colors: { ink: '#263b32', muted: '#778b7e', line: '#d1e1d5', page: '#edf7ef', white: '#ffffffcc', violet: '#557d69', violetSoft: '#e5f0e8cc', blue: '#668aa0', blueSoft: '#e7f0f4cc', green: '#39866b', greenSoft: '#e1f2e9cc', amber: '#c49a55', amberSoft: '#faf0dccc', orange: '#c97b5e' } },
  'Lavender Planner': { colors: { ink: '#332b4b', muted: '#89829e', line: '#ddd5ee', page: '#f5f2fc', white: '#ffffffcc', violet: '#7967b5', violetSoft: '#eeeafdcc', blue: '#758fbe', blueSoft: '#e8eef9cc', green: '#6fa08f', greenSoft: '#e7f3edcc', amber: '#c9a05f', amberSoft: '#fbf2dfcc', orange: '#cc8297' } },
  'Paper Notebook': { colors: { ink: '#373536', muted: '#8e8885', line: '#ded4c7', page: '#f8f3e8', white: '#fffefacc', violet: '#8d6572', violetSoft: '#f3e8ebcc', blue: '#66849b', blueSoft: '#e8f0f3cc', green: '#6f967b', greenSoft: '#e8f1e8cc', amber: '#c29358', amberSoft: '#faf0ddcc', orange: '#c77d5d' } },
};

function readSavedTheme(): ThemeName {
  try {
    const saved = typeof globalThis !== 'undefined' && 'localStorage' in globalThis ? globalThis.localStorage.getItem('localLearnTheme') : null;
    return saved && saved in themes ? saved as ThemeName : 'Soft Academic';
  } catch (_) { return 'Soft Academic'; }
}

export let activeTheme: ThemeName = readSavedTheme();
export const theme = { colors: { ...themes[activeTheme].colors }, radius: { card: 18, small: 12 } };

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
