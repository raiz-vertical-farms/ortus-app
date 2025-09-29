import React from "react";
import styles from "./Tabs.module.css";
import { classNames } from "../../utils/classnames";

export type TabOption<TValue extends string | number> = {
  value: TValue;
  label: React.ReactNode;
  disabled?: boolean;
};

export type TabsProps<TValue extends string | number> = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  value: TValue;
  onChange: (value: TValue) => void;
  options: TabOption<TValue>[];
};

function TabsComponent<TValue extends string | number>({
  value,
  onChange,
  options,
  className,
  onKeyDown,
  ...props
}: TabsProps<TValue>): React.JSX.Element {
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const hasEnabledOption = options.some((option) => !option.disabled);
    if (!hasEnabledOption) return;

    const currentIndex = options.findIndex((option) => option.value === value);

    const moveFocus = (nextIndex: number) => {
      const nextOption = options[nextIndex];
      if (!nextOption || nextOption.disabled) return;

      if (nextOption.value !== value) {
        onChange(nextOption.value);
      }

      tabRefs.current[nextIndex]?.focus();
    };

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      let nextIndex = currentIndex;
      for (let i = 0; i < options.length; i++) {
        nextIndex = (nextIndex + 1) % options.length;
        if (!options[nextIndex].disabled) {
          moveFocus(nextIndex);
          break;
        }
      }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      let nextIndex = currentIndex;
      for (let i = 0; i < options.length; i++) {
        nextIndex = (nextIndex - 1 + options.length) % options.length;
        if (!options[nextIndex].disabled) {
          moveFocus(nextIndex);
          break;
        }
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      const nextIndex = options.findIndex((option) => !option.disabled);
      if (nextIndex !== -1) {
        moveFocus(nextIndex);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) {
          moveFocus(i);
          break;
        }
      }
    }
  };

  return (
    <div
      role="tablist"
      className={classNames(styles.tabs, className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;
        const isDisabled = Boolean(option.disabled);

        return (
          <button
            key={String(option.value)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={isDisabled}
            tabIndex={isActive ? 0 : -1}
            className={classNames(styles.tab, {
              [styles.active]: isActive,
              [styles.disabled]: isDisabled,
            })}
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled || isActive) return;
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const Tabs = TabsComponent as <TValue extends string | number>(
  props: TabsProps<TValue>
) => React.JSX.Element;

export default Tabs;
