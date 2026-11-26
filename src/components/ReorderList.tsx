import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef, type MutableRefObject, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { TOUCH, useTheme } from './theme';

interface Props<T> {
  items: T[];
  keyOf: (item: T, index: number) => string;
  /** Every row has this exact height (rows are absolutely positioned). */
  rowHeight: number;
  /** Row content; the drag handle is added on the right. */
  renderRow: (item: T, index: number) => ReactNode;
  /** Called once per drop with display indexes. The parent persists and passes new items. */
  onMove: (from: number, to: number) => void;
  /** Spoken name of an item, for the screen-reader move actions. */
  itemLabel: (item: T) => string;
  header?: ReactNode;
  footer?: ReactNode;
}

const EDGE = 72; // px from the top/bottom edge where dragging starts auto-scrolling
const MAX_SCROLL_STEP = 14; // px per frame at the very edge

/**
 * A list whose rows can be dragged into a new order by their handle. Built on the core
 * touch-responder system and Animated (no gesture/animation libraries): the dragged row follows the finger, the
 * rows it passes slide out of the way, and the list auto-scrolls near its edges.
 */
export function ReorderList<T>({ items, keyOf, rowHeight, renderRow, onMove, itemLabel, header, footer }: Props<T>) {
  const t = useTheme();
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragging = useRef(false);

  // Follow the parent's items, except mid-drag (the parent's copy is about to change).
  useEffect(() => {
    if (!dragging.current) setOrder(items);
  }, [items]);

  // One animated slot offset per row key, so rows can glide to their new places.
  const [slots] = useState(() => new Map<string, Animated.Value>());
  const keys = order.map(keyOf);
  const slotOf = (key: string, index: number) => {
    let v = slots.get(key);
    if (!v) {
      v = new Animated.Value(index * rowHeight);
      slots.set(key, v);
    }
    return v;
  };

  // Where each row should sit: shifted by one while the dragged row hovers past it.
  const targetIndex = (i: number) => {
    if (!drag || i === drag.from) return i;
    const { from, to } = drag;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
  };

  useEffect(() => {
    keys.forEach((key, i) => {
      if (drag && i === drag.from) return;
      Animated.timing(slotOf(key, i), { toValue: targetIndex(i) * rowHeight, duration: 140, useNativeDriver: false }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.from, drag?.to, keys.join('|'), rowHeight]);

  // ---- dragging
  const [dy] = useState(() => new Animated.Value(0));
  const [scrollComp] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const scrollAtStart = useRef(0);
  // Viewport position (measured when a drag starts) and sizes, for edge auto-scroll.
  const viewport = useRef({ top: 0, height: 0, measured: false });
  const contentHeight = useRef(0);
  const viewRef = useRef<ComponentRef<typeof View>>(null);
  const finger = useRef({ pageY: 0, dy: 0 });
  const raf = useRef<number | null>(null);
  const state = useRef({ from: -1, to: -1 });

  const computeTo = () => {
    const delta = finger.current.dy + (scrollY.current - scrollAtStart.current);
    const to = Math.round((state.current.from * rowHeight + delta) / rowHeight);
    return Math.max(0, Math.min(order.length - 1, to));
  };

  const update = () => {
    const to = computeTo();
    if (to !== state.current.to) {
      state.current.to = to;
      setDrag({ from: state.current.from, to });
    }
  };

  const autoScroll = () => {
    const { top, height, measured } = viewport.current;
    if (!measured || height <= 0) {
      raf.current = requestAnimationFrame(autoScroll);
      return;
    }
    const y = finger.current.pageY;
    let step = 0;
    if (y < top + EDGE) step = -MAX_SCROLL_STEP * Math.min(1, (top + EDGE - y) / EDGE);
    else if (y > top + height - EDGE) step = MAX_SCROLL_STEP * Math.min(1, (y - (top + height - EDGE)) / EDGE);
    if (step) {
      const maxScroll = Math.max(0, contentHeight.current - height);
      const next = Math.min(maxScroll, Math.max(0, scrollY.current + step));
      if (next !== scrollY.current) {
        scrollY.current = next;
        scrollRef.current?.scrollTo({ y: next, animated: false });
        scrollComp.setValue(next - scrollAtStart.current);
        update();
      }
    }
    raf.current = requestAnimationFrame(autoScroll);
  };

  const start = (index: number, pageY: number) => {
    dragging.current = true;
    state.current = { from: index, to: index };
    scrollAtStart.current = scrollY.current;
    finger.current = { pageY, dy: 0 };
    dy.setValue(0);
    scrollComp.setValue(0);
    viewport.current.measured = false;
    viewRef.current?.measureInWindow((_x: number, top: number, _w: number, height: number) => {
      viewport.current = { top, height, measured: true };
    });
    setDrag({ from: index, to: index });
    raf.current = requestAnimationFrame(autoScroll);
  };

  const move = (deltaY: number, pageY: number) => {
    finger.current = { pageY, dy: deltaY };
    dy.setValue(deltaY);
    update();
  };

  const end = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    const { from } = state.current;
    if (from < 0) return;
    const to = computeTo();
    const key = keys[from];
    // Land the dragged row in its slot, then commit the new order.
    slotOf(key, from).setValue(to * rowHeight);
    dy.setValue(0);
    scrollComp.setValue(0);
    if (to !== from) {
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setOrder(next);
      onMove(from, to);
    }
    state.current = { from: -1, to: -1 };
    dragging.current = false;
    setDrag(null);
  };

  const handlers = { start, move, end };
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });

  const moveBy = (i: number, delta: number) => {
    const to = i + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(i, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    onMove(i, to);
  };

  return (
    <View ref={viewRef} style={{ flex: 1 }} collapsable={false}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!drag}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        onContentSizeChange={(_w, h) => (contentHeight.current = h)}
        scrollEventThrottle={16}
      >
        {header}
        <View style={{ height: order.length * rowHeight }}>
          {order.map((item, i) => {
            const key = keys[i];
            const active = drag?.from === i;
            const translate = active ? Animated.add(slotOf(key, i), Animated.add(dy, scrollComp)) : slotOf(key, i);
            return (
              <Animated.View
                key={key}
                style={[
                  styles.row,
                  { height: rowHeight, transform: [{ translateY: translate }], zIndex: active ? 2 : 1 },
                  active && { backgroundColor: t.elevated, elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>{renderRow(item, i)}</View>
                <Handle
                  index={i}
                  handlers={latest}
                  label={itemLabel(item)}
                  canUp={i > 0}
                  canDown={i < order.length - 1}
                  onMoveBy={(d) => moveBy(i, d)}
                />
              </Animated.View>
            );
          })}
        </View>
        {footer}
      </ScrollView>
    </View>
  );
}

function Handle({
  index,
  handlers,
  label,
  canUp,
  canDown,
  onMoveBy,
}: {
  index: number;
  handlers: MutableRefObject<{
    start: (i: number, pageY: number) => void;
    move: (deltaY: number, pageY: number) => void;
    end: () => void;
  }>;
  label: string;
  canUp: boolean;
  canDown: boolean;
  onMoveBy: (delta: number) => void;
}) {
  const t = useTheme();
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  }, [index]);
  // Plain responder props (no PanResponder): the handle claims the touch and keeps it.
  const startY = useRef(0);
  const responderProps = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      startY.current = e.nativeEvent.pageY;
      handlers.current.start(indexRef.current, e.nativeEvent.pageY);
    },
    onResponderMove: (e: GestureResponderEvent) => handlers.current.move(e.nativeEvent.pageY - startY.current, e.nativeEvent.pageY),
    onResponderRelease: () => handlers.current.end(),
    onResponderTerminate: () => handlers.current.end(),
  };
  const actions = [
    ...(canUp ? [{ name: 'moveUp', label: 'Move up' }] : []),
    ...(canDown ? [{ name: 'moveDown', label: 'Move down' }] : []),
  ];
  return (
    <View
      {...responderProps}
      style={styles.handle}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${label}`}
      accessibilityHint="Drag up or down, or use the actions to move this song."
      accessibilityActions={actions}
      onAccessibilityAction={(e) => onMoveBy(e.nativeEvent.actionName === 'moveUp' ? -1 : 1)}
    >
      <Ionicons name="reorder-three" size={26} color={t.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center' },
  handle: { width: TOUCH + 8, height: '100%', alignItems: 'center', justifyContent: 'center' },
});
