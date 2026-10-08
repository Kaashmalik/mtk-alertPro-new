import { render } from '@testing-library/react-native';

import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';

describe('Input accessibility', () => {
  it('exposes the visible label to assistive tech', () => {
    // The label is a sibling <Text>, which a screen reader does not associate
    // with the field, so it has to be bridged explicitly.
    const { getByLabelText } = render(<Input label="Email" />);
    expect(getByLabelText('Email')).toBeTruthy();
  });

  it('lets an explicit accessibilityLabel win over the visible label', () => {
    const { getByLabelText } = render(
      <Input label="Email" accessibilityLabel="Work email address" />,
    );
    expect(getByLabelText('Work email address')).toBeTruthy();
  });

  it('renders a secure-field toggle that names its action and state', () => {
    const { getByLabelText } = render(
      <Input label="Password" secureTextEntry />,
    );
    const toggle = getByLabelText('Show password');
    expect(toggle).toBeTruthy();
    // Only the pressed flag is ours — TouchableOpacity contributes its own
    // `selected`, and React Native normalises the object with undefined keys.
    expect(toggle.props.accessibilityState.selected).toBe(true);
  });
});

describe('ErrorState accessibility', () => {
  it('announces itself so a failed load is not silent', () => {
    const { getByLabelText } = render(
      <ErrorState
        title="Couldn't load"
        message="Network unreachable"
        onRetry={() => {}}
      />,
    );
    const alert = getByLabelText("Couldn't load. Network unreachable");
    expect(alert).toBeTruthy();
    // A screen swap with no announcement is indistinguishable from success.
    expect(alert.props.accessibilityRole ?? alert.props.role).toBeTruthy();
  });

  it('uses a network-specific message when the device is offline', () => {
    const { getByText } = render(<ErrorState kind="network" />);
    expect(getByText("Can't reach the server")).toBeTruthy();
  });
});
