import type { ReactNode } from 'react';
import { SidebarMenuButton, useSidebar } from './components/ui/sidebar';

export const workspaceRoutes = {
  slides: '/dashboard',
  playlists: '/dashboard/playlists',
  devices: '/dashboard/screens',
  media: '/dashboard/media',
  accounts: '/dashboard/users',
  password: '/dashboard/password',
  settings: '/dashboard/settings',
};
export type WorkspaceView = keyof typeof workspaceRoutes;
export function workspaceView() {
  return (
    (Object.keys(workspaceRoutes) as WorkspaceView[]).find(
      (key) => workspaceRoutes[key] === location.pathname,
    ) || 'slides'
  );
}

export function WorkspaceNavigationButton({
  active,
  onNavigate,
  children,
}: {
  active: boolean;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      isActive={active}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        setOpenMobile(false);
        onNavigate();
      }}
    >
      {children}
    </SidebarMenuButton>
  );
}
