import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';

export function InspectorScrollArea({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const [{ height, offset }, setThumb] = useState({ height: 0, offset: 0 });

  const syncThumb = useCallback(() => {
    const node = viewport.current;
    if (node === null) return;

    const { clientHeight, scrollHeight, scrollTop } = node;
    const maxScroll = scrollHeight - clientHeight;
    const height =
      maxScroll > 0
        ? Math.min(clientHeight, Math.max(20, clientHeight ** 2 / scrollHeight))
        : 0;
    const offset =
      maxScroll > 0 ? ((clientHeight - height) * scrollTop) / maxScroll : 0;
    setThumb((previous) =>
      previous.height === height && previous.offset === offset
        ? previous
        : { height, offset },
    );
  }, []);

  useEffect(() => {
    syncThumb();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(syncThumb);
    if (viewport.current !== null) observer.observe(viewport.current);
    if (content.current !== null) observer.observe(content.current);
    return () => observer.disconnect();
  }, [syncThumb]);

  const scrollFromPointer = (
    event: PointerEvent<HTMLDivElement>,
    grabOffset: number,
  ) => {
    const node = viewport.current;
    if (node === null || node.clientHeight <= height) return;

    const pointerY =
      event.clientY - event.currentTarget.getBoundingClientRect().top;
    const progress = (pointerY - grabOffset) / (node.clientHeight - height);
    node.scrollTop =
      Math.max(0, Math.min(progress, 1)) *
      (node.scrollHeight - node.clientHeight);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewport}
        id={id}
        role="region"
        aria-label="属性内容"
        tabIndex={0}
        onScroll={syncThumb}
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div ref={content}>{children}</div>
      </div>
      {height > 0 ? (
        <div
          aria-hidden="true"
          className="group absolute inset-y-0 right-0 w-2.5 touch-none select-none"
          onWheel={(event) => {
            const node = viewport.current;
            if (node === null || event.ctrlKey) return;

            const unit = [1, 16, node.clientHeight][event.deltaMode] ?? 1;
            node.scrollTop += event.deltaY * unit;
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;

            event.preventDefault();
            const relativeY =
              event.clientY -
              event.currentTarget.getBoundingClientRect().top -
              offset;
            const grabOffset =
              relativeY >= 0 && relativeY <= height ? relativeY : height / 2;
            drag.current = { pointerId: event.pointerId, offset: grabOffset };
            event.currentTarget.setPointerCapture(event.pointerId);
            scrollFromPointer(event, grabOffset);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId) {
              scrollFromPointer(event, drag.current.offset);
            }
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.pointerId === event.pointerId)
              drag.current = null;
          }}
        >
          <div
            className="pointer-events-none absolute top-0 right-0.5 w-1 py-px"
            style={{ height, transform: `translateY(${offset}px)` }}
          >
            <div className="h-full rounded-full bg-[#C8CBD0] transition-colors group-hover:bg-[#9CA3AF]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
