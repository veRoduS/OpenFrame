import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export function IconButton({
  label,
  caption,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
  caption?: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={`${caption ? 'caption-button' : 'icon-button'} ${active ? 'active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
        {caption && <span>{caption}</span>}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
