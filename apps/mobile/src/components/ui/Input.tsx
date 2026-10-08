import { designSystem } from '@/theme/design-system';
import { Eye, EyeOff } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

type FocusHandler = NonNullable<TextInputProps['onFocus']>;
type BlurHandler = NonNullable<TextInputProps['onBlur']>;
type FocusEventArg = Parameters<FocusHandler>[0];
type BlurEventArg = Parameters<BlurHandler>[0];

export const Input = forwardRef<TextInput, InputProps>(
  (
    {
      label,
      error,
      leftIcon,
      rightIcon,
      secureTextEntry,
      style,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [isSecure, setIsSecure] = useState(Boolean(secureTextEntry));
    const [isFocused, setIsFocused] = useState(false);

    // Keep internal visibility state in sync when the parent toggles the prop
    // (e.g. login's showPassword). Prevents the eye state from going stale.
    useEffect(() => {
      setIsSecure(Boolean(secureTextEntry));
    }, [secureTextEntry]);

    const handleFocus = useCallback(
      (e: FocusEventArg) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus],
    );

    const handleBlur = useCallback(
      (e: BlurEventArg) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur],
    );

    const toggleSecure = useCallback(() => {
      setIsSecure((prev) => !prev);
    }, []);

    return (
      <View style={styles.container} collapsable={false}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View
          collapsable={false}
          style={[
            styles.inputWrapper,
            isFocused && styles.inputFocused,
            error ? styles.inputError : null,
            props.editable === false ? styles.inputDisabled : null,
          ]}
        >
          {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
          <TextInput
            ref={ref}
            {...props}
            style={[styles.input, style]}
            placeholderTextColor={designSystem.colors.text.muted}
            secureTextEntry={secureTextEntry !== undefined ? isSecure : false}
            onFocus={handleFocus}
            onBlur={handleBlur}
            // The visible label above is not announced by a screen reader, so
            // every input in the app (login, register, camera add, profile,
            // password change) was an unlabelled "text field". Bridge them, and
            // let an explicit accessibilityLabel from the caller win.
            accessibilityLabel={props.accessibilityLabel ?? label}
            // A validation error is otherwise visual-only: a screen-reader user
            // submits an empty field and hears nothing about why.
            accessibilityHint={error ?? props.accessibilityHint}
          />
          {secureTextEntry ? (
            <TouchableOpacity
              onPress={toggleSecure}
              style={styles.rightIcon}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={isSecure ? 'Show password' : 'Hide password'}
              accessibilityState={{ selected: isSecure }}
            >
              {isSecure ? (
                <Eye size={20} color={designSystem.colors.text.muted} />
              ) : (
                <EyeOff size={20} color={designSystem.colors.text.muted} />
              )}
            </TouchableOpacity>
          ) : null}
          {rightIcon && !secureTextEntry ? (
            <View style={styles.rightIcon}>{rightIcon}</View>
          ) : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    marginBottom: designSystem.spacing.sm,
    fontSize: designSystem.typography.size.sm,
    fontWeight: '500',
    color: designSystem.colors.text.secondary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.lg,
    borderWidth: 1.5,
    borderColor: designSystem.colors.border.default,
    paddingHorizontal: designSystem.spacing.lg,
  },
  inputFocused: {
    borderColor: designSystem.colors.primary[500],
    ...designSystem.shadows.glow.primary,
  },
  inputError: {
    borderColor: designSystem.colors.status.danger,
    ...designSystem.shadows.glow.danger,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  leftIcon: {
    marginRight: designSystem.spacing.md,
  },
  rightIcon: {
    marginLeft: designSystem.spacing.md,
  },
  input: {
    flex: 1,
    height: 56,
    fontSize: designSystem.typography.size.base,
    color: designSystem.colors.text.primary,
    fontFamily: designSystem.typography.fontFamily.regular,
    paddingVertical: 0,
  },
  error: {
    marginTop: designSystem.spacing.xs,
    fontSize: designSystem.typography.size.sm,
    color: designSystem.colors.status.danger,
  },
});

Input.displayName = 'Input';
