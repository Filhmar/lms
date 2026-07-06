import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
type ButtonSize = "default" | "exam" | "card" | "small";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconSize?: number;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "default",
  icon,
  iconSize = 15,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const sizeClass =
    size === "exam"
      ? " rl-btn--exam"
      : size === "card"
        ? " rl-btn--card"
        : size === "small"
          ? " rl-btn--small"
          : "";
  return (
    <button
      className={`rl-btn rl-btn--${variant}${sizeClass} ${className}`.trim()}
      {...props}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  small?: boolean;
  iconSize?: number;
}

export function IconButton({
  icon,
  label,
  small,
  iconSize,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`rl-btn rl-btn--icon${small ? " rl-btn--icon-sm" : ""} ${className}`.trim()}
      aria-label={label}
      {...props}
    >
      <Icon name={icon} size={iconSize ?? (small ? 14 : 18)} />
    </button>
  );
}
