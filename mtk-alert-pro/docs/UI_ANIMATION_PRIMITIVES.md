# UI animation primitives

Reusable motion building blocks that give the app a consistent, modern "feel".
Both live in `components/animated` and run on the UI thread (Reanimated), so
they stay smooth even while JS is busy.

## `PressableScale`

A premium replacement for `TouchableOpacity`: the surface springs down on touch
and back on release, with optional haptics. Use it for any tappable card or
button where a reactive press improves the feel.

```tsx
import { PressableScale } from '@/components/animated';

<PressableScale
  style={styles.actionButton}
  onPress={() => router.push('/cameras/add')}
  accessibilityLabel="Add camera"
>
  <Plus size={20} color="white" />
  <Text style={styles.actionLabel}>Add Camera</Text>
</PressableScale>
```

Props: `onPress`, `onLongPress`, `activeScale` (default `0.96`),
`haptic` (`'light'` default, `null` to disable), `disabled`, `style`,
`accessibilityLabel`, `hitSlop`.

Notes:
- Already wired into the dashboard quick-action buttons.
- Gesture callbacks run on the JS thread (`.runOnJS(true)`), so handlers are
  called directly — no deprecated `runOnJS()` wrapper.
- `GestureDetector` works inside a `ScrollView`; vertical scrolling still wins
  over a tap, so it's safe in scrollable screens.

## `StaggerItem`

Wraps a list row so it fades + slides in, offset by its index, for a cascading
entrance. Use it for `.map()`-rendered lists. (Rows that already animate on
mount — e.g. `CameraCard`, `AlertCard` — don't need it; double-wrapping would
double-animate.)

```tsx
import { StaggerItem } from '@/components/animated';

{items.map((item, i) => (
  <StaggerItem key={item.id} index={i}>
    <Row {...item} />
  </StaggerItem>
))}
```

Props: `index` (required), `step` (ms per item, default `55`),
`maxDelay` (default `400`), `style`.
