import {Text as NativeText, TextInput as NativeInput, Pressable as NativeButton, View, type TextProps, type TextInputProps, type PressableProps, type ViewProps} from 'react-native';
import {createThemedStyles, theme} from '../theme';

export function Text({style, ...props}: TextProps) {return <NativeText {...props} style={[s.text, style]}/>;}
export function TextInput({style, ...props}: TextInputProps) {return <NativeInput placeholderTextColor={theme.colors.muted} {...props} style={[s.input, props.multiline && s.multiline, style]}/>;}
export function Pressable({style, disabled, ...props}: PressableProps) {return <NativeButton accessibilityRole="button" disabled={disabled} {...props} style={state => [s.button, state.pressed && s.pressed, disabled && s.disabled, typeof style === 'function' ? style(state) : style]}/>;}
export function Panel({style, ...props}: ViewProps) {return <View {...props} style={[s.panel, style]}/>;}
export function Heading({children}: {children: React.ReactNode}) {return <Text style={s.heading}>{children}</Text>;}
export function Caption({children}: {children: React.ReactNode}) {return <Text style={s.caption}>{children}</Text>;}
const s = createThemedStyles({
  text: {color: theme.colors.ink, fontSize: 14, lineHeight: 21},
  input: {color: theme.colors.ink, backgroundColor: theme.colors.page, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13, minHeight: 48, fontSize: 14},
  multiline: {minHeight: 104, textAlignVertical: 'top'},
  button: {backgroundColor: theme.colors.violetSoft, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 12, minHeight: 44, paddingHorizontal: 15, paddingVertical: 11, alignItems: 'center', justifyContent: 'center'},
  pressed: {opacity: 0.7}, disabled: {opacity: 0.45},
  panel: {padding: 22, borderRadius: 18, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, gap: 14},
  heading: {fontSize: 20, lineHeight: 28, fontWeight: '700', color: theme.colors.ink},
  caption: {fontSize: 13, lineHeight: 20, color: theme.colors.muted},
});
