import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type AnimationEvent,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

type AnimatedDialogProps = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
  open: boolean;
  className: string;
  children: ReactNode;
};

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPrefersReducedMotion = (): void => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    syncPrefersReducedMotion();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncPrefersReducedMotion);
      return () => {
        mediaQuery.removeEventListener("change", syncPrefersReducedMotion);
      };
    }

    mediaQuery.addListener(syncPrefersReducedMotion);
    return () => {
      mediaQuery.removeListener(syncPrefersReducedMotion);
    };
  }, []);

  return prefersReducedMotion;
}

const AnimatedDialog = forwardRef<HTMLDivElement, AnimatedDialogProps>(
  function AnimatedDialog(
    { open, className, children, onAnimationEnd, ...divProps },
    ref,
  ): JSX.Element | null {
    const prefersReducedMotion = usePrefersReducedMotion();
    const [shouldRender, setShouldRender] = useState(open);
    const [isExiting, setIsExiting] = useState(false);
    const [renderedChildren, setRenderedChildren] = useState(children);
    const [renderedClassName, setRenderedClassName] = useState(className);

    useEffect(() => {
      if (open) {
        setRenderedChildren(children);
        setRenderedClassName(className);
      }
    }, [children, className, open]);

    useEffect(() => {
      if (open) {
        setShouldRender(true);
        setIsExiting(false);
        return;
      }

      if (!shouldRender) {
        setIsExiting(false);
        return;
      }

      if (prefersReducedMotion) {
        setShouldRender(false);
        setIsExiting(false);
        return;
      }

      setIsExiting(true);
    }, [open, prefersReducedMotion, shouldRender]);

    const handleAnimationEnd = useCallback(
      (event: AnimationEvent<HTMLDivElement>): void => {
        onAnimationEnd?.(event);
        if (open || event.target !== event.currentTarget) {
          return;
        }
        setShouldRender(false);
        setIsExiting(false);
      },
      [onAnimationEnd, open],
    );

    if (!shouldRender) {
      return null;
    }

    const visibilityClassName = open
      ? "is-visible"
      : isExiting
        ? "is-exiting"
        : "is-visible";

    return (
      <div
        {...divProps}
        ref={ref}
        className={`${renderedClassName} ${visibilityClassName}`.trim()}
        onAnimationEnd={handleAnimationEnd}
      >
        {renderedChildren}
      </div>
    );
  },
);

export default AnimatedDialog;
