import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { version } from '../package.json';
import {
  minimumPasswordLength,
  maximumPasswordLength,
} from '../server/password-policy.mjs';
import { Accounts, type Auth } from './accounts';
import {
  ManageAccessButton,
  ResourceAccessDialog,
  type SharedResource,
} from './resource-access';
import { DeviceRecovery } from './device-recovery';
import { WeatherOptions } from './weather-options';
import {
  Monitor,
  Users,
  FileCog,
  LayoutTemplate,
  ListVideo,
  Images,
  Plus,
  ArrowLeft,
  Play,
  Save,
  Trash2,
  Copy,
  Type,
  ImagePlus,
  Clock,
  Timer,
  CloudSun,
  Crop,
  Undo2,
  Redo2,
  ArrowUp,
  ArrowDown,
  LogOut,
  Check,
  RefreshCw,
  Power,
  CheckCircle2,
  Circle,
  Settings,
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Layers,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  api,
  newLayer,
  playlistDuration,
  type Asset,
  type Device,
  type Layer,
  type Library,
  type MediaFolder,
  type Playlist,
  type Slide,
} from './types';
import { SlideCanvas } from './canvas';
import { MediaLibrary } from './media-library';
import { FontSettings } from './font-settings';
import { ScreenSetup } from './screen-setup';
import { resizeLayer } from './geometry.mjs';
import { useUnsavedNavigation } from '@/hooks/use-unsaved-navigation';
import { localDateTime } from '../player/web/counter.js';
import { playlistItemStatus } from './playlist-status.mjs';
import { v4 as uuid } from 'uuid';
import { customFontAlias, systemFonts, type CustomFont } from './font-utils';

function IconButton({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string;
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
            className={`icon-button ${active ? 'active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide,
  destructive = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  destructive?: boolean;
}) {
  if (destructive)
    return (
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <AlertDialogContent className="of-modal">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description || title}
          </AlertDialogDescription>
          {children}
        </AlertDialogContent>
      </AlertDialog>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className={`of-modal ${wide ? 'wide' : ''}`}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description || title}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
const emptyLibrary: Library = {
  slides: [],
  playlists: [],
  assets: [],
  folders: [],
  devices: [],
};
const viewInfo = {
  slides: { title: 'Slides', icon: LayoutTemplate },
  playlists: { title: 'Playlists', icon: ListVideo },
  devices: { title: 'Screens', icon: Monitor },
  media: { title: 'Media', icon: Images },
  accounts: { title: 'Users & Groups', icon: Users },
  settings: { title: 'Settings', icon: Settings },
};
type View = keyof typeof viewInfo;

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [activation, setActivation] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get('activate'),
  );
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [view, setView] = useState<View>('slides');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Slide | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    action: () => Promise<void>;
  } | null>(null);
  const [pairCode, setPairCode] = useState('');
  const [pairOpen, setPairOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [accessResource, setAccessResource] = useState<SharedResource | null>(
    null,
  );
  const refresh = async () => setLibrary(await api<Library>('/api/library'));
  const refreshFonts = async () =>
    setFonts(await api<CustomFont[]>('/api/fonts'));
  const run = (action: () => Promise<void>, message = '') => {
    void (async () => {
      setError('');
      setBusy(true);
      try {
        await action();
        if (message) setNotice(message);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  };
  useEffect(() => {
    api<Auth>('/api/auth')
      .then((next) => {
        if (!new URLSearchParams(location.hash.slice(1)).has('activate'))
          history.replaceState(
            history.state,
            '',
            next.authenticated ? '/dashboard' : '/login',
          );
        setAuth(next);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (auth?.authenticated) refresh().catch((e) => setError(e.message));
  }, [auth]);
  useEffect(() => {
    if (auth?.authenticated) refreshFonts().catch((e) => setError(e.message));
  }, [auth]);
  useEffect(() => {
    for (const face of document.fonts) {
      if (!face.family.startsWith('OpenFrameFont_')) continue;
      if (!fonts.some((font) => customFontAlias(font.id) === face.family))
        document.fonts.delete(face);
    }
    for (const font of fonts) {
      if (
        [...document.fonts].some(
          (face) => face.family === customFontAlias(font.id),
        )
      )
        continue;
      void new FontFace(customFontAlias(font.id), `url("${font.url}")`)
        .load()
        .then((face) => document.fonts.add(face))
        .catch(() => setError(`Could not load the ${font.family} font file.`));
    }
  }, [fonts]);
  useEffect(() => {
    if (!auth?.authenticated || view !== 'devices') return;
    const t = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      10000,
    );
    return () => clearInterval(t);
  }, [auth, view]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  async function upload(
    file: File,
    folderId: string | null = null,
    shareWithSlideId?: string,
  ): Promise<Asset> {
    const form = new FormData();
    form.append('file', file);
    if (folderId) form.append('folderId', folderId);
    if (shareWithSlideId) form.append('shareWithSlideId', shareWithSlideId);
    const asset = await api<Asset>('/api/assets', 'POST', form);
    await refresh();
    return asset;
  }
  async function createSlide() {
    const slide = await api<Slide>('/api/slides', 'POST', {
      name: 'Untitled slide',
      width: 1920,
      height: 1080,
      background: '#ffffff',
      layers: [
        {
          ...newLayer('text'),
          y: 32,
          height: 36,
          text: 'Something worth\nsharing.',
          fontSize: 144,
          bold: true,
        },
      ],
    });
    await refresh();
    setEditing(slide);
  }
  async function savePlaylist(p: Playlist) {
    const saved = await api<Playlist>(
      p.id ? `/api/playlists/${p.id}` : '/api/playlists',
      p.id ? 'PUT' : 'POST',
      p,
    );
    await refresh();
    return saved;
  }
  async function approve() {
    const d = library.devices.find(
      (d) => d.code === pairCode.trim().toUpperCase(),
    );
    if (!d)
      throw new Error(
        'No screen with that code. Check the player is connected to this server.',
      );
    await api(`/api/devices/${d.id}/approve`, 'POST', { code: pairCode });
    await refresh();
    setPairOpen(false);
    setPairCode('');
  }
  return (
    <TooltipProvider delay={300}>
      {!auth ? (
        <div className="auth-screen">
          <Monitor size={36} />
          <h1>OpenFrame</h1>
          <p>{error || 'Connecting to your server...'}</p>
          {error && <button onClick={() => location.reload()}>Retry</button>}
        </div>
      ) : !auth.authenticated || activation ? (
        <div className="auth-screen">
          <a
            className="auth-brand"
            href="/"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            <Monitor />
            <span>OpenFrame</span>
          </a>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const password = form.get('password');
              run(async () => {
                if (activation && password !== form.get('confirm'))
                  throw new Error('Passwords do not match');
                await api(
                  activation
                    ? '/api/activate'
                    : auth.setup
                      ? '/api/setup'
                      : '/api/login',
                  'POST',
                  {
                    password,
                    username: form.get('username'),
                    token: activation,
                  },
                );
                const signedIn = await api<Auth>('/api/auth');
                setLibrary(emptyLibrary);
                setEditing(null);
                setPlaylist(null);
                setPreview(null);
                setActivation(null);
                history.replaceState(null, '', '/dashboard');
                setAuth(signedIn);
              });
            }}
          >
            <span className="eyebrow">YOUR LOCAL SIGNAGE SERVER</span>
            <h1>
              {activation
                ? 'Set your password.'
                : auth.setup
                  ? 'Make room for\na better display.'
                  : 'Welcome back.'}
            </h1>
            <p>
              {activation
                ? 'Choose a password for your account.'
                : auth.setup
                  ? 'Create your administrator password.'
                  : 'Sign in to OpenFrame.'}
            </p>
            {!activation && (
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  defaultValue={auth.setup ? 'admin' : ''}
                  required
                />
              </label>
            )}
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={
                  auth.setup || activation ? minimumPasswordLength : undefined
                }
                maxLength={maximumPasswordLength}
                required
                autoComplete={
                  auth.setup || activation ? 'new-password' : 'current-password'
                }
                placeholder={
                  auth.setup || activation
                    ? `At least ${minimumPasswordLength} characters`
                    : undefined
                }
              />
            </label>
            {activation && (
              <label>
                Confirm password
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={minimumPasswordLength}
                  maxLength={maximumPasswordLength}
                />
              </label>
            )}
            {error && (
              <div role="alert" className="inline-error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {activation
                ? 'Set password & sign in'
                : auth.setup
                  ? 'Create administrator'
                  : 'Sign in'}{' '}
              <ArrowLeft className="rotate-180" size={18} />
            </button>
          </form>
          <span className="auth-foot">
            Open source. On your network. Under your control.
          </span>
        </div>
      ) : (
        <SidebarProvider
          className="app-shell"
          style={{ '--sidebar-width': '210px' } as React.CSSProperties}
        >
          <Sidebar className="navigation">
            <SidebarHeader>
              <div className="brand">
                <span className="brand-mark">
                  <Monitor size={20} />
                </span>
                OpenFrame
              </div>
            </SidebarHeader>
            <SidebarContent>
              <div className="nav-caption">WORKSPACE</div>
              <SidebarMenu>
                {(Object.entries(viewInfo) as [View, typeof viewInfo.slides][])
                  .filter(
                    ([key]) =>
                      key !== 'settings' || auth.user?.role === 'superadmin',
                  )
                  .map(([key, item]) => (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        isActive={view === key}
                        onClick={() => {
                          setView(key);
                        }}
                      >
                        <item.icon size={18} />
                        <span>{item.title}</span>
                        <span className="nav-count">
                          {key === 'accounts' || key === 'settings'
                            ? ''
                            : key === 'media'
                              ? library.assets.length
                              : library[key].length}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarContent>
            <SidebarFooter>
              <div className="nav-bottom">
                <span>
                  OpenFrame <small>{version}</small>
                </span>
                <IconButton
                  label="Sign out"
                  onClick={() =>
                    run(async () => {
                      await api('/api/logout', 'POST');
                      setLibrary(emptyLibrary);
                      history.replaceState(null, '', '/login');
                      setAuth({ setup: false, authenticated: false });
                    })
                  }
                >
                  <LogOut size={17} />
                </IconButton>
              </div>
            </SidebarFooter>
          </Sidebar>
          <main className="main-workspace">
            <header className="topbar">
              <div className="breadcrumb">
                <SidebarTrigger />
                <span>Workspace</span>
                <span>/</span>
                <strong>{viewInfo[view].title}</strong>
              </div>
            </header>
            <div className="page-content">
              <div
                className={`page-heading ${view === 'devices' ? 'screens-heading' : ''}`}
              >
                <div>
                  <span className="eyebrow">
                    {view === 'slides'
                      ? 'CREATE & COMPOSE'
                      : view === 'playlists'
                        ? 'ORDER & PUBLISH'
                        : view === 'devices'
                          ? 'YOUR DISPLAY NETWORK'
                          : view === 'accounts'
                            ? 'PEOPLE & ACCESS'
                            : view === 'settings'
                              ? 'WORKSPACE CONFIGURATION'
                              : 'IMAGE LIBRARY'}
                  </span>
                  <h1>{viewInfo[view].title}</h1>
                </div>
                <div className="heading-actions">
                  {view === 'slides' && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => run(createSlide)}
                    >
                      <Plus size={18} />
                      New slide
                    </button>
                  )}
                  {view === 'playlists' && (
                    <button
                      className="primary"
                      onClick={() =>
                        setPlaylist({
                          id: '',
                          name: 'Untitled playlist',
                          items: [],
                        })
                      }
                    >
                      <Plus size={18} />
                      New playlist
                    </button>
                  )}
                  {view === 'devices' && auth.user?.role === 'superadmin' && (
                    <>
                      <button onClick={() => setSetupOpen(true)}>
                        <FileCog size={18} />
                        Screen setup
                      </button>
                      <IconButton
                        label="Refresh screens"
                        onClick={() => run(refresh)}
                      >
                        <RefreshCw size={18} />
                      </IconButton>
                      <button
                        className="primary"
                        onClick={() => setPairOpen(true)}
                      >
                        <Plus size={18} />
                        Pair screen
                      </button>
                    </>
                  )}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                  <button
                    aria-label="Dismiss error"
                    onClick={() => setError('')}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {view === 'accounts' && auth.user && (
                <Accounts
                  user={auth.user}
                  library={library}
                  refresh={refresh}
                />
              )}
              {view === 'settings' && auth.user?.role === 'superadmin' && (
                <FontSettings fonts={fonts} refresh={refreshFonts} />
              )}
              {view === 'slides' && (
                <>
                  <div className="section-meta">
                    <span>{library.slides.length} slides</span>
                    <span>Draft library</span>
                  </div>
                  {library.slides.length ? (
                    <div className="slide-grid">
                      {library.slides.map((slide) => (
                        <article className="slide-card" key={slide.id}>
                          <button
                            className="thumbnail-button"
                            onClick={() => setEditing(slide)}
                            aria-label={`Edit ${slide.name}`}
                          >
                            <SlideCanvas
                              slide={slide}
                              assets={library.assets}
                            />
                          </button>
                          <div className="slide-card-info">
                            <button
                              className="title-button"
                              onClick={() => setEditing(slide)}
                            >
                              <strong>{slide.name}</strong>
                              <span>
                                {slide.width} x {slide.height}{' '}
                                <span className="dot-separator">/</span>{' '}
                                {slide.layers.length} layers
                              </span>
                            </button>
                            <IconButton
                              label={`Duplicate ${slide.name}`}
                              onClick={() =>
                                run(async () => {
                                  await api('/api/slides', 'POST', {
                                    ...slide,
                                    name: `${slide.name.slice(0, 90)} copy`,
                                  });
                                  await refresh();
                                }, 'Slide duplicated')
                              }
                            >
                              <Copy size={16} />
                            </IconButton>
                            <IconButton
                              label={`Delete ${slide.name}`}
                              onClick={() =>
                                setConfirm({
                                  title: `Delete "${slide.name}"?`,
                                  action: async () => {
                                    await api(
                                      `/api/slides/${slide.id}`,
                                      'DELETE',
                                    );
                                    await refresh();
                                  },
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                          <ManageAccessButton
                            resourceName={slide.name}
                            onClick={() =>
                              setAccessResource({
                                kind: 'slide',
                                id: slide.id,
                                name: slide.name,
                              })
                            }
                          />
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <LayoutTemplate size={38} strokeWidth={1.4} />
                      <h2>Your first slide starts here.</h2>
                      <button onClick={() => run(createSlide)} disabled={busy}>
                        <Plus size={18} />
                        Create a slide
                      </button>
                    </div>
                  )}
                </>
              )}
              {view === 'playlists' && (
                <>
                  <div className="section-meta">
                    <span>{library.playlists.length} playlists</span>
                    <span>Changes go live when published</span>
                  </div>
                  {library.playlists.length ? (
                    <div className="playlist-list">
                      {library.playlists.map((p) => (
                        <article className="playlist-row" key={p.id}>
                          <div className="playlist-thumb">
                            {library.slides.find(
                              (s) => s.id === p.items[0]?.slideId,
                            ) ? (
                              <SlideCanvas
                                slide={library.slides.find(
                                  (s) => s.id === p.items[0].slideId,
                                )!}
                                assets={library.assets}
                              />
                            ) : (
                              <ListVideo size={24} />
                            )}
                          </div>
                          <button
                            className="title-button"
                            onClick={() => setPlaylist(p)}
                          >
                            <strong>{p.name}</strong>
                            <span>
                              {p.items.length} slides{' '}
                              <span className="dot-separator">/</span>{' '}
                              {playlistDuration(p)} seconds
                            </span>
                          </button>
                          <span
                            className={`badge ${p.publishedAt ? 'green' : ''}`}
                          >
                            {p.publishedAt ? 'Published' : 'Draft'}
                          </span>
                          <div className="row-actions">
                            <IconButton
                              label={`Preview ${p.name}`}
                              disabled={!p.items.length}
                              onClick={() => setPreview(p.id)}
                            >
                              <Play size={18} />
                            </IconButton>
                            <button onClick={() => setPlaylist(p)}>Edit</button>
                            <ManageAccessButton
                              resourceName={p.name}
                              onClick={() =>
                                setAccessResource({
                                  kind: 'playlist',
                                  id: p.id,
                                  name: p.name,
                                })
                              }
                            />
                            <IconButton
                              label={`Delete ${p.name}`}
                              onClick={() =>
                                setConfirm({
                                  title: `Delete "${p.name}"?`,
                                  action: async () => {
                                    await api(
                                      `/api/playlists/${p.id}`,
                                      'DELETE',
                                    );
                                    await refresh();
                                  },
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <ListVideo size={38} strokeWidth={1.4} />
                      <h2>A sequence for every screen.</h2>
                      <button
                        onClick={() =>
                          setPlaylist({
                            id: '',
                            name: 'Untitled playlist',
                            items: [],
                          })
                        }
                      >
                        <Plus size={18} />
                        Create a playlist
                      </button>
                    </div>
                  )}
                </>
              )}
              {view === 'devices' && (
                <>
                  <div className="screen-summary">
                    <div>
                      <strong>
                        {
                          library.devices.filter(
                            (d) =>
                              d.approved &&
                              d.lastSeen &&
                              Date.now() - Date.parse(d.lastSeen) < 90000,
                          ).length
                        }
                      </strong>
                      <span>
                        <span className="status-dot" />
                        Online
                      </span>
                    </div>
                    <div>
                      <strong>
                        {
                          library.devices.filter(
                            (d) =>
                              d.approved &&
                              (!d.lastSeen ||
                                Date.now() - Date.parse(d.lastSeen) >= 90000),
                          ).length
                        }
                      </strong>
                      <span>Offline</span>
                    </div>
                    <div>
                      <strong>
                        {library.devices.filter((d) => !d.approved).length}
                      </strong>
                      <span>Awaiting approval</span>
                    </div>
                  </div>
                  {library.devices.length ? (
                    <div className="devices-list">
                      {library.devices.map((d) => (
                        <DeviceRow
                          key={d.id}
                          device={d}
                          canManage={auth.user?.role === 'superadmin'}
                          playlists={library.playlists}
                          busy={busy}
                          onRename={async (name) => {
                            await api(`/api/devices/${d.id}`, 'PUT', {
                              name,
                            });
                            await refresh();
                            setNotice('Screen renamed');
                          }}
                          onSave={(patch) =>
                            run(async () => {
                              await api(`/api/devices/${d.id}`, 'PUT', patch);
                              await refresh();
                            }, 'Screen updated')
                          }
                          onApprove={() => {
                            setPairCode('');
                            setPairOpen(true);
                          }}
                          onManageAccess={() =>
                            setAccessResource({
                              kind: 'device',
                              id: d.id,
                              name: d.name,
                            })
                          }
                          onCommand={(type) => {
                            const action = async () => {
                              await api(
                                `/api/devices/${d.id}/command`,
                                'POST',
                                { type },
                              );
                              await refresh();
                            };
                            if (type === 'reboot')
                              setConfirm({
                                title: `Restart "${d.name}"?`,
                                action,
                              });
                            else run(action, 'Refresh queued');
                          }}
                          onDelete={() =>
                            setConfirm({
                              title: `Revoke "${d.name}"?`,
                              action: async () => {
                                await api(`/api/devices/${d.id}`, 'DELETE');
                                await refresh();
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Monitor size={38} strokeWidth={1.4} />
                      <h2>Ready for your first screen.</h2>
                      <button onClick={() => setPairOpen(true)}>
                        <Plus size={18} />
                        Pair a screen
                      </button>
                    </div>
                  )}
                </>
              )}
              {view === 'media' && (
                <MediaLibrary
                  assets={library.assets}
                  folders={library.folders}
                  onRefresh={refresh}
                  onUpload={upload}
                  onManageAccess={(asset) =>
                    setAccessResource({
                      kind: 'asset',
                      id: asset.id,
                      name: asset.name,
                    })
                  }
                />
              )}
            </div>
            <footer className="workspace-footer">
              <span>YOUR CONTENT. YOUR SCREENS.</span>
              <span>OpenFrame / Community edition</span>
            </footer>
          </main>
          {editing && (
            <Editor
              initial={editing}
              assets={library.assets}
              fonts={fonts}
              folders={library.folders}
              onRefresh={refresh}
              onUpload={upload}
              onClose={() => setEditing(null)}
              onSave={async (slide) => {
                const saved = await api<Slide>(
                  `/api/slides/${slide.id}`,
                  'PUT',
                  slide,
                );
                await refresh();
                return saved;
              }}
            />
          )}
          {playlist && (
            <PlaylistEditor
              initial={playlist}
              slides={library.slides}
              assets={library.assets}
              onClose={() => setPlaylist(null)}
              onSave={savePlaylist}
              onSharePlan={(candidate) =>
                api<PlaylistShareChange[]>(
                  `/api/playlists/${candidate.id || 'new'}/share-plan`,
                  'POST',
                  candidate,
                )
              }
              onShare={(id, changes) =>
                api(
                  `/api/playlists/${id || 'new'}/share-apply`,
                  'POST',
                  changes,
                )
              }
              onPublish={async (p) => {
                const saved = await savePlaylist(p);
                await api(`/api/playlists/${saved.id}/publish`, 'POST');
                await refresh();
                return { ...saved, publishedAt: new Date().toISOString() };
              }}
              onPreview={setPreview}
            />
          )}
          {setupOpen && <ScreenSetup onClose={() => setSetupOpen(false)} />}
          {auth.user && (
            <ResourceAccessDialog
              resource={accessResource}
              user={auth.user}
              onClose={() => setAccessResource(null)}
              refresh={refresh}
            />
          )}
          <Modal
            title="Pair a screen"
            description="Enter the eight-character code shown on the player display."
            open={pairOpen}
            onClose={() => setPairOpen(false)}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(approve, 'Screen approved');
              }}
            >
              <label>
                Pairing code
                <input
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                  placeholder="A1B2C3D4"
                  minLength={8}
                  maxLength={8}
                  required
                  className="pair-code"
                />
              </label>
              {error && (
                <p role="alert" className="inline-error">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                <Check size={18} />
                Approve screen
              </button>
            </form>
          </Modal>
          <Modal
            title={confirm?.title || 'Confirm'}
            destructive
            description="This action takes effect immediately on the server."
            open={!!confirm}
            onClose={() => setConfirm(null)}
          >
            <div className="dialog-actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await confirm!.action();
                    setConfirm(null);
                  })
                }
              >
                Confirm
              </button>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </Modal>
          <Modal
            title="Playlist preview"
            description="Preview of the saved draft."
            open={!!preview}
            onClose={() => setPreview(null)}
            wide
          >
            {preview && (
              <iframe
                title="Playlist preview"
                className="preview-frame"
                src={`/player/?preview=${preview}`}
                allow="fullscreen"
              />
            )}
          </Modal>
          {notice && (
            <output className="notification">
              <CheckCircle2 size={18} />
              {notice}
            </output>
          )}
        </SidebarProvider>
      )}
    </TooltipProvider>
  );
}

function DeviceRow({
  device,
  playlists,
  onRename,
  onSave,
  onApprove,
  onCommand,
  onDelete,
  onManageAccess,
  busy,
  canManage,
}: {
  device: Device;
  canManage: boolean;
  playlists: Playlist[];
  onRename: (name: string) => Promise<void>;
  onSave: (d: Device) => void;
  onApprove: () => void;
  onCommand: (type: 'refresh' | 'reboot') => void;
  onDelete: () => void;
  onManageAccess: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(device.name);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');
  useEffect(() => setName(device.name), [device.name]);
  const saveName = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === device.name || savingName) return;
    setSavingName(true);
    setNameError('');
    try {
      await onRename(trimmedName);
      setEditingName(false);
    } catch (error) {
      setNameError((error as Error).message);
    } finally {
      setSavingName(false);
    }
  };
  const online =
    device.lastSeen && Date.now() - Date.parse(device.lastSeen) < 90000;
  return (
    <article className="device-row">
      <div className="device-identity">
        <Monitor size={25} />
        <div>
          {editingName ? (
            <form className="screen-name-edit" onSubmit={saveName}>
              <input
                aria-label="Screen name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                disabled={savingName}
              />
              <button
                className="primary"
                type="submit"
                disabled={
                  savingName || !name.trim() || name.trim() === device.name
                }
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={savingName}
                onClick={() => {
                  setName(device.name);
                  setNameError('');
                  setEditingName(false);
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="screen-name-display">
              <strong>{device.name}</strong>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                aria-label={`Rename ${device.name}`}
              >
                Rename
              </button>
            </div>
          )}
          {nameError && <p className="inline-error">{nameError}</p>}
          <span>
            {device.lastSeen
              ? `Last heartbeat: ${new Date(device.lastSeen).toLocaleString()}`
              : 'Last heartbeat: not yet received'}
          </span>
        </div>
        <span className={`badge ${device.approved && online ? 'green' : ''}`}>
          {!device.approved ? 'Pending' : online ? 'Online' : 'Offline'}
        </span>
      </div>
      {device.approved ? (
        <>
          <div className="device-controls">
            <label>
              Playlist
              <select
                value={device.playlistId || ''}
                disabled={busy}
                onChange={(e) =>
                  onSave({ ...device, playlistId: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.publishedAt ? '' : ' (draft)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rotation
              <select
                value={device.rotation}
                disabled={busy}
                onChange={(e) =>
                  onSave({
                    ...device,
                    rotation: Number(e.target.value) as Device['rotation'],
                  })
                }
              >
                {[0, 90, 180, 270].map((r) => (
                  <option key={r} value={r}>
                    {r} degrees
                  </option>
                ))}
              </select>
            </label>
            <label className="switch-label" htmlFor={`blank-${device.id}`}>
              Blank screen
              <Switch
                id={`blank-${device.id}`}
                checked={device.blank}
                disabled={busy}
                onCheckedChange={(blank) => onSave({ ...device, blank })}
              />
            </label>
            <div className="row-actions">
              <ManageAccessButton
                resourceName={device.name}
                onClick={onManageAccess}
              />
              <IconButton
                label="Refresh content"
                disabled={busy}
                onClick={() => onCommand('refresh')}
              >
                <RefreshCw size={18} />
              </IconButton>
              <IconButton
                label="Restart player"
                disabled={busy}
                onClick={() => onCommand('reboot')}
              >
                <Power size={18} />
              </IconButton>
              {canManage && (
                <IconButton label="Revoke device" onClick={onDelete}>
                  <Trash2 size={18} />
                </IconButton>
              )}
            </div>
          </div>
          {device.command && (
            <p className="device-message">
              {device.command.type === 'reboot' ? 'Restart' : 'Refresh'} queued
            </p>
          )}
          <DeviceRecovery id={device.id} phase={device.status?.recovery} />
          {device.status?.error && (
            <p className="inline-error">{device.status.error}</p>
          )}
          {device.status?.playback && (
            <p className="device-message">
              Playback: {device.status.playback.phase}
              {device.status.playback.preparationMs !== undefined
                ? ` / Last preparation: ${device.status.playback.preparationMs} ms`
                : ''}
              {device.status.playback.missedDeadlines
                ? ` / ${device.status.playback.missedDeadlines} delayed switches`
                : ''}
            </p>
          )}
          {device.status?.playback?.error && (
            <p role="alert" className="inline-error">
              {device.status.playback.error}
            </p>
          )}
        </>
      ) : (
        <div className="device-controls">
          {canManage && <button onClick={onApprove}>Enter pairing code</button>}
          {canManage && (
            <IconButton label="Remove pending screen" onClick={onDelete}>
              <Trash2 size={18} />
            </IconButton>
          )}
        </div>
      )}
    </article>
  );
}

function PropertySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="property-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Editor({
  initial,
  assets,
  fonts,
  folders,
  onRefresh,
  onClose,
  onSave,
  onUpload,
}: {
  initial: Slide;
  assets: Asset[];
  fonts: CustomFont[];
  folders: MediaFolder[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onSave: (s: Slide) => Promise<Slide>;
  onUpload: (
    f: File,
    folderId?: string | null,
    shareWithSlideId?: string,
  ) => Promise<Asset>;
}) {
  const [slide, setSlide] = useState<Slide>(structuredClone(initial));
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [selected, setSelected] = useState<string | null>(
    initial.layers[0]?.id || null,
  );
  const [past, setPast] = useState<Slide[]>([]);
  const [future, setFuture] = useState<Slide[]>([]);
  const [media, setMedia] = useState<'add' | { replace: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const dirty = JSON.stringify(slide) !== saved;
  const current = slide.layers.find((l) => l.id === selected);
  const currentAsset = assets.find((asset) => asset.id === current?.assetId);
  const navigation = useUnsavedNavigation(dirty, onClose);
  function change(next: Slide, history = true) {
    if (history) {
      setPast((p) => [...p.slice(-49), slide]);
      setFuture([]);
    }
    setSlide(next);
  }
  function patchLayer(patch: Partial<Layer>) {
    if (!current) return;
    if (
      current.lockMode === 'full' &&
      (!Object.hasOwn(patch, 'lockMode') ||
        Object.keys(patch).some((key) => key !== 'lockMode'))
    )
      return;
    if (
      current.lockMode === 'movement' &&
      (patch.x !== undefined || patch.y !== undefined)
    )
      return;
    const next = { ...current, ...patch };
    if (
      current.type === 'image' &&
      current.lockAspect !== false &&
      (patch.width !== undefined || patch.height !== undefined)
    ) {
      Object.assign(
        next,
        resizeLayer(
          current,
          'se',
          patch.width === undefined ? 0 : patch.width - current.width,
          patch.height === undefined ? 0 : patch.height - current.height,
          true,
        ),
      );
    }
    if (current.lockMode === 'movement') {
      next.width = Math.min(next.width, 100 - current.x);
      next.height = Math.min(next.height, 100 - current.y);
    } else {
      next.x = Math.min(next.x, 100 - next.width);
      next.y = Math.min(next.y, 100 - next.height);
    }
    change({
      ...slide,
      layers: slide.layers.map((l) => (l.id === selected ? next : l)),
    });
  }
  function add(type: Layer['type'], assetId?: string) {
    const layer = newLayer(type, assetId);
    const background = slide.background
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16));
    layer.color =
      background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114 <
      140
        ? '#ffffff'
        : '#202923';
    const asset = assets.find((a) => a.id === assetId);
    if (type === 'image' && asset) {
      layer.height =
        (((layer.width * slide.width) / slide.height) * asset.height) /
        asset.width;
      if (layer.height > 80) {
        layer.width *= 80 / layer.height;
        layer.height = 80;
      }
      layer.width = Math.max(1, layer.width);
      layer.height = Math.max(1, layer.height);
    }
    change({ ...slide, layers: [...slide.layers, layer] });
    setSelected(layer.id);
    setMedia(null);
  }
  function chooseImage(assetId: string) {
    if (media === 'add') add('image', assetId);
    else if (media && typeof media === 'object') {
      const target = slide.layers.find((layer) => layer.id === media.replace);
      if (target?.type === 'image' && target.lockMode !== 'full') {
        change({
          ...slide,
          layers: slide.layers.map((layer) =>
            layer.id === target.id
              ? { ...layer, assetId, cropX: 50, cropY: 50, cropZoom: 1 }
              : layer,
          ),
        });
      }
    }
    setMedia(null);
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await onSave(slide);
      setSlide(result);
      setSaved(JSON.stringify(result));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function reorder(direction: number) {
    if (!current) return;
    const layers = [...slide.layers];
    const index = layers.findIndex((l) => l.id === selected),
      target = index + direction;
    if (target < 0 || target >= layers.length) return;
    [layers[index], layers[target]] = [layers[target], layers[index]];
    change({ ...slide, layers });
  }
  return (
    <div className="editor-overlay">
      <header className="editor-header">
        <IconButton
          label="Back to slides"
          onClick={() => navigation.requestLeave()}
          disabled={busy}
        >
          <ArrowLeft size={20} />
        </IconButton>
        <div className="editor-title">
          <input
            aria-label="Slide name"
            disabled={busy}
            value={slide.name}
            onChange={(e) => change({ ...slide, name: e.target.value })}
            maxLength={100}
          />
          <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        </div>
        <div className="editor-header-actions">
          <label className="editor-background">
            Background
            <input
              type="color"
              aria-label="Slide background"
              disabled={busy}
              value={slide.background}
              onChange={(e) => change({ ...slide, background: e.target.value })}
            />
          </label>
          <IconButton
            label="Undo"
            disabled={busy || !past.length}
            onClick={() => {
              setFuture((f) => [slide, ...f]);
              setSlide(past[past.length - 1]);
              setPast((p) => p.slice(0, -1));
            }}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={busy || !future.length}
            onClick={() => {
              setPast((p) => [...p, slide]);
              setSlide(future[0]);
              setFuture((f) => f.slice(1));
            }}
          >
            <Redo2 size={18} />
          </IconButton>
          <button
            className="primary"
            disabled={busy || !slide.name.trim()}
            onClick={save}
          >
            <Save size={17} />
            Save slide
          </button>
        </div>
      </header>
      <div className="editor-body" inert={busy}>
        <aside className="layer-panel">
          <h2>
            <Layers size={16} />
            Layers <span>{slide.layers.length}</span>
          </h2>
          <div className="insert-tools">
            <IconButton label="Add text" onClick={() => add('text')}>
              <Type size={20} />
            </IconButton>
            <IconButton label="Add image" onClick={() => setMedia('add')}>
              <ImagePlus size={20} />
            </IconButton>
            <IconButton label="Add clock widget" onClick={() => add('clock')}>
              <Clock size={20} />
            </IconButton>
            <IconButton
              label="Add weather widget"
              onClick={() => add('weather')}
            >
              <CloudSun size={20} />
            </IconButton>
            <IconButton
              label="Add counter widget"
              onClick={() => add('counter')}
            >
              <Timer size={20} />
            </IconButton>
          </div>
          <div className="layer-list">
            {[...slide.layers].reverse().map((layer, i) => (
              <button
                key={layer.id}
                className={selected === layer.id ? 'chosen' : ''}
                onClick={() => {
                  if (layer.id !== selected) setCropMode(false);
                  setSelected(layer.id);
                }}
              >
                {layer.type === 'image' ? (
                  <Images size={16} />
                ) : layer.type === 'counter' ? (
                  <Timer size={16} />
                ) : layer.type === 'weather' ? (
                  <CloudSun size={16} />
                ) : layer.type === 'clock' ? (
                  <Clock size={16} />
                ) : (
                  <Type size={16} />
                )}
                <span>
                  {layer.type === 'text'
                    ? layer.text || 'Text'
                    : layer.type === 'counter'
                      ? 'Counter'
                      : layer.type === 'weather'
                        ? layer.weather?.name || 'Weather'
                        : layer.type === 'clock'
                          ? 'Clock'
                          : assets.find((a) => a.id === layer.assetId)?.name ||
                            'Image'}
                </span>
                <small>{slide.layers.length - i}</small>
              </button>
            ))}
          </div>
          <div className="canvas-settings">
            <h3>Canvas</h3>
            <label>
              Orientation
              <select
                value={slide.width > slide.height ? 'landscape' : 'portrait'}
                onChange={(e) =>
                  change({
                    ...slide,
                    width: e.target.value === 'landscape' ? 1920 : 1080,
                    height: e.target.value === 'landscape' ? 1080 : 1920,
                  })
                }
              >
                <option value="landscape">Landscape / 16:9</option>
                <option value="portrait">Portrait / 9:16</option>
              </select>
            </label>
          </div>
        </aside>
        <section className="canvas-workspace">
          <div className="canvas-meta">
            <span>
              {slide.width} x {slide.height}
            </span>
            <span>{slide.width > slide.height ? 'LANDSCAPE' : 'PORTRAIT'}</span>
          </div>
          <div
            className={`canvas-holder ${slide.width < slide.height ? 'portrait' : ''}`}
          >
            <SlideCanvas
              slide={slide}
              assets={assets}
              selected={selected}
              interactive
              cropMode={
                cropMode && current?.type === 'image' && current.fit === 'cover'
              }
              onCrop={(id, crop) =>
                setSlide((s) => ({
                  ...s,
                  layers: s.layers.map((l) =>
                    l.id === id ? { ...l, ...crop } : l,
                  ),
                }))
              }
              onSelect={(id) => {
                if (id !== selected) setCropMode(false);
                setSelected(id);
              }}
              onDragStart={() => {
                setPast((p) => [...p.slice(-49), slide]);
                setFuture([]);
              }}
              onResize={(id, geometry) =>
                setSlide((s) => ({
                  ...s,
                  layers: s.layers.map((l) =>
                    l.id === id ? { ...l, ...geometry } : l,
                  ),
                }))
              }
              onMove={(id, x, y) =>
                setSlide((s) => ({
                  ...s,
                  layers: s.layers.map((l) =>
                    l.id === id ? { ...l, x, y } : l,
                  ),
                }))
              }
            />
          </div>
          <div className="canvas-bottom">
            <span>{selected ? 'Layer selected' : 'Canvas selected'}</span>
            <span>{dirty ? 'Draft' : 'Saved'}</span>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </section>
        <aside className="properties-panel" aria-label="Layer properties">
          <header className="property-panel-header">
            <h2>Properties</h2>
            {current && (
              <div className="property-heading">
                <strong>
                  {current.type === 'text'
                    ? 'Text'
                    : current.type === 'counter'
                      ? 'Counter widget'
                      : current.type === 'weather'
                        ? 'Weather widget'
                        : current.type === 'clock'
                          ? 'Clock widget'
                          : 'Image'}
                </strong>
                <IconButton
                  label="Delete layer"
                  disabled={current.lockMode === 'full'}
                  onClick={() => {
                    change({
                      ...slide,
                      layers: slide.layers.filter((l) => l.id !== selected),
                    });
                    setSelected(null);
                  }}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            )}
          </header>
          {current && (
            <label className="property-lock">
              Layer lock
              <select
                aria-label="Layer lock"
                title="Full Lock prevents movement and editing. Lock movement allows content edits."
                value={current.lockMode || 'none'}
                onChange={(e) =>
                  patchLayer({
                    lockMode:
                      e.target.value === 'none'
                        ? undefined
                        : (e.target.value as Layer['lockMode']),
                  })
                }
              >
                <option value="none">Unlocked</option>
                <option value="full">Full Lock</option>
                <option value="movement">Lock movement</option>
              </select>
            </label>
          )}
          {current ? (
            <fieldset
              className="layer-properties"
              disabled={current.lockMode === 'full'}
              inert={current.lockMode === 'full'}
            >
              <PropertySection
                title={
                  current.type === 'image'
                    ? 'Source image'
                    : current.type === 'text'
                      ? 'Content'
                      : 'Widget settings'
                }
              >
                {current.type === 'text' && (
                  <textarea
                    aria-label="Text content"
                    rows={4}
                    value={current.text}
                    maxLength={4000}
                    onChange={(e) => patchLayer({ text: e.target.value })}
                  />
                )}
                {current.type === 'image' && (
                  <>
                    <div className="property-image-preview">
                      {currentAsset && <img src={currentAsset.url} alt="" />}
                      <span>{currentAsset?.name || 'Image'}</span>
                    </div>
                    <button
                      type="button"
                      className="property-action"
                      onClick={() => setMedia({ replace: current.id })}
                    >
                      <ImagePlus size={16} />
                      Replace image
                    </button>
                  </>
                )}
                {current.type === 'weather' && current.weather && (
                  <>
                    <WeatherOptions
                      key={current.id}
                      config={current.weather}
                      onChange={(patch) =>
                        patchLayer({
                          weather: { ...current.weather!, ...patch },
                        })
                      }
                    />
                    <label>
                      Location name
                      <input
                        value={current.weather.name}
                        maxLength={80}
                        onChange={(e) =>
                          patchLayer({
                            weather: {
                              ...current.weather!,
                              name: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <div className="number-grid weather-coordinates">
                      <label>
                        Latitude
                        <input
                          type="number"
                          min={-90}
                          max={90}
                          step="0.0001"
                          value={current.weather.latitude ?? ''}
                          onChange={(e) =>
                            patchLayer({
                              weather: {
                                ...current.weather!,
                                latitude:
                                  e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Longitude
                        <input
                          type="number"
                          min={-180}
                          max={180}
                          step="0.0001"
                          value={current.weather.longitude ?? ''}
                          onChange={(e) =>
                            patchLayer({
                              weather: {
                                ...current.weather!,
                                longitude:
                                  e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Temperature unit
                      <select
                        value={current.weather.unit}
                        onChange={(e) =>
                          patchLayer({
                            weather: {
                              ...current.weather!,
                              unit: e.target.value as 'F' | 'C',
                            },
                          })
                        }
                      >
                        <option value="F">Fahrenheit</option>
                        <option value="C">Celsius</option>
                      </select>
                    </label>
                  </>
                )}
                {current.type === 'clock' && (
                  <>
                    <label>
                      Clock format
                      <select
                        value={
                          current.clock?.showSeconds ? 'seconds' : 'minutes'
                        }
                        onChange={(e) =>
                          patchLayer({
                            clock: {
                              ...current.clock,
                              showSeconds: e.target.value === 'seconds',
                            },
                          })
                        }
                      >
                        <option value="minutes">HH:MM</option>
                        <option value="seconds">HH:MM:SS</option>
                      </select>
                    </label>
                    <label className="property-switch" htmlFor="clock-24-hour">
                      24-hour time
                      <Switch
                        id="clock-24-hour"
                        checked={current.clock?.hour12 === false}
                        onCheckedChange={(enabled) =>
                          patchLayer({
                            clock: {
                              ...current.clock,
                              hour12: !enabled,
                            },
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {current.type === 'counter' && current.counter && (
                  <>
                    <label>
                      Target date and time
                      <input
                        type="datetime-local"
                        step="1"
                        value={localDateTime(current.counter.targetAt)}
                        onChange={(e) => {
                          if (
                            e.target.value &&
                            Number.isFinite(new Date(e.target.value).getTime())
                          )
                            patchLayer({
                              counter: {
                                ...current.counter!,
                                targetAt: new Date(
                                  e.target.value,
                                ).toISOString(),
                              },
                            });
                        }}
                      />
                    </label>
                    <label>
                      Granularity
                      <select
                        value={current.counter.unit}
                        onChange={(e) =>
                          patchLayer({
                            counter: {
                              ...current.counter!,
                              unit: e.target.value as NonNullable<
                                Layer['counter']
                              >['unit'],
                            },
                          })
                        }
                      >
                        {['seconds', 'minutes', 'hours', 'days'].map((unit) => (
                          <option key={unit} value={unit}>
                            {unit[0].toUpperCase() + unit.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="property-field-grid">
                      {(['prefix', 'suffix'] as const).map((field) => (
                        <label key={field}>
                          {field === 'prefix' ? 'Prefix' : 'Suffix'}
                          <input
                            type="text"
                            maxLength={500}
                            value={current.counter![field] ?? ''}
                            onChange={(e) =>
                              patchLayer({
                                counter: {
                                  ...current.counter!,
                                  [field]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      Goal message (optional)
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={current.counter.goalMessage ?? ''}
                        onChange={(e) =>
                          patchLayer({
                            counter: {
                              ...current.counter!,
                              goalMessage: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="property-switch" htmlFor="counter-unit">
                      Show unit
                      <Switch
                        id="counter-unit"
                        checked={current.counter.showUnit}
                        onCheckedChange={(showUnit) =>
                          patchLayer({
                            counter: { ...current.counter!, showUnit },
                          })
                        }
                      />
                    </label>
                  </>
                )}
              </PropertySection>
              <PropertySection title="Position & size">
                <div className="number-grid">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key === 'x' || key === 'y'
                        ? key.toUpperCase()
                        : key === 'width'
                          ? 'Width'
                          : 'Height'}
                      <div className="number-unit">
                        <input
                          type="number"
                          aria-label={`Layer ${key}`}
                          value={Math.round(current[key] * 100) / 100}
                          disabled={
                            current.lockMode === 'movement' &&
                            (key === 'x' || key === 'y')
                          }
                          min={key === 'width' || key === 'height' ? 1 : 0}
                          max={100}
                          step={0.5}
                          onChange={(e) => {
                            if (e.target.value !== '')
                              patchLayer({
                                [key]: Math.max(
                                  key === 'width' || key === 'height' ? 1 : 0,
                                  Math.min(100, Number(e.target.value)),
                                ),
                              });
                          }}
                        />
                        <span>%</span>
                      </div>
                    </label>
                  ))}
                </div>
                {current.type === 'image' && (
                  <label
                    className="property-switch"
                    htmlFor="lock-image-aspect"
                  >
                    Lock proportions
                    <Switch
                      id="lock-image-aspect"
                      checked={current.lockAspect !== false}
                      onCheckedChange={(lockAspect) =>
                        patchLayer({ lockAspect })
                      }
                    />
                  </label>
                )}
              </PropertySection>
              <PropertySection
                title={
                  current.type === 'image' ? 'Image display' : 'Typography'
                }
              >
                {current.type !== 'image' ? (
                  <>
                    <label>
                      Font family
                      <select
                        value={
                          current.fontId
                            ? `custom:${current.fontId}`
                            : `system:${current.fontFamily || 'Arial'}`
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value.startsWith('custom:'))
                            patchLayer({
                              fontId: value.slice('custom:'.length),
                            });
                          else
                            patchLayer({
                              fontId: undefined,
                              fontFamily: value.slice('system:'.length),
                            });
                        }}
                      >
                        <optgroup label="Built-in fonts">
                          {systemFonts.map((family) => (
                            <option key={family} value={`system:${family}`}>
                              {family}
                            </option>
                          ))}
                        </optgroup>
                        {fonts.length > 0 && (
                          <optgroup label="Custom fonts">
                            {fonts.map((font) => (
                              <option key={font.id} value={`custom:${font.id}`}>
                                {font.family}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <label className="property-switch" htmlFor="auto-size-text">
                      Auto-size to box
                      <Switch
                        id="auto-size-text"
                        checked={current.autoSize || false}
                        onCheckedChange={(autoSize) => patchLayer({ autoSize })}
                      />
                    </label>
                    <div className="property-field-grid">
                      <label>
                        Font size
                        <input
                          type="number"
                          value={current.fontSize}
                          disabled={current.autoSize}
                          min={12}
                          max={400}
                          onChange={(e) => {
                            if (e.target.value !== '')
                              patchLayer({
                                fontSize: Math.max(
                                  12,
                                  Math.min(400, Number(e.target.value)),
                                ),
                              });
                          }}
                        />
                      </label>
                      <label className="property-color-field">
                        Text color
                        <input
                          type="color"
                          value={current.color}
                          onChange={(e) =>
                            patchLayer({ color: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="property-control-row">
                      <span>Style</span>
                      <fieldset
                        className="format-tools"
                        aria-label="Text style"
                      >
                        <IconButton
                          label="Bold"
                          active={current.bold}
                          onClick={() => patchLayer({ bold: !current.bold })}
                        >
                          <Bold size={18} />
                        </IconButton>
                        {(['left', 'center', 'right'] as const).map(
                          (align, i) => (
                            <IconButton
                              key={align}
                              label={`Align ${align}`}
                              active={current.align === align}
                              onClick={() => patchLayer({ align })}
                            >
                              {i === 0 ? (
                                <AlignLeft size={18} />
                              ) : i === 1 ? (
                                <AlignCenter size={18} />
                              ) : (
                                <AlignRight size={18} />
                              )}
                            </IconButton>
                          ),
                        )}
                      </fieldset>
                    </div>
                    <div className="property-control-row">
                      <span>Vertical</span>
                      <fieldset
                        className="format-tools"
                        aria-label="Vertical alignment"
                      >
                        {(['top', 'middle', 'bottom'] as const).map(
                          (verticalAlign, i) => (
                            <IconButton
                              key={verticalAlign}
                              label={`Align ${verticalAlign}`}
                              active={
                                (current.verticalAlign || 'top') ===
                                verticalAlign
                              }
                              onClick={() => patchLayer({ verticalAlign })}
                            >
                              {i === 0 ? (
                                <AlignVerticalJustifyStart size={18} />
                              ) : i === 1 ? (
                                <AlignVerticalJustifyCenter size={18} />
                              ) : (
                                <AlignVerticalJustifyEnd size={18} />
                              )}
                            </IconButton>
                          ),
                        )}
                      </fieldset>
                    </div>
                  </>
                ) : (
                  <>
                    <label>
                      Image fit
                      <select
                        value={current.fit}
                        onChange={(e) =>
                          patchLayer({ fit: e.target.value as Layer['fit'] })
                        }
                      >
                        <option value="cover">Fill frame</option>
                        <option value="contain">Fit image</option>
                      </select>
                    </label>
                    {current.fit === 'cover' && (
                      <details className="property-details" key={current.id}>
                        <summary>Crop adjustments</summary>
                        <div className="crop-controls">
                          <button
                            type="button"
                            className={cropMode ? 'primary' : ''}
                            aria-pressed={cropMode}
                            onClick={() => setCropMode(!cropMode)}
                          >
                            <Crop size={17} />
                            {cropMode ? 'Done cropping' : 'Adjust crop'}
                          </button>
                          <div className="slider-field">
                            <span>Zoom</span>
                            <Slider
                              aria-label="Crop zoom"
                              value={[current.cropZoom ?? 1]}
                              min={1}
                              max={4}
                              step={0.05}
                              onValueChange={(v) =>
                                patchLayer({
                                  cropZoom: Array.isArray(v) ? v[0] : v,
                                })
                              }
                            />
                          </div>
                          <div className="slider-field">
                            <span>Horizontal position</span>
                            <Slider
                              aria-label="Crop horizontal position"
                              value={[current.cropX ?? 50]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={(v) =>
                                patchLayer({
                                  cropX: Array.isArray(v) ? v[0] : v,
                                })
                              }
                            />
                          </div>
                          <div className="slider-field">
                            <span>Vertical position</span>
                            <Slider
                              aria-label="Crop vertical position"
                              value={[current.cropY ?? 50]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={(v) =>
                                patchLayer({
                                  cropY: Array.isArray(v) ? v[0] : v,
                                })
                              }
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              patchLayer({ cropX: 50, cropY: 50, cropZoom: 1 })
                            }
                          >
                            <Undo2 size={16} />
                            Reset crop
                          </button>
                        </div>
                      </details>
                    )}
                  </>
                )}
              </PropertySection>
              <PropertySection title="Arrange">
                <div className="format-tools">
                  <IconButton
                    label="Bring forward"
                    disabled={current.lockMode === 'full'}
                    onClick={() => reorder(1)}
                  >
                    <ArrowUp size={18} />
                  </IconButton>
                  <IconButton
                    label="Send backward"
                    disabled={current.lockMode === 'full'}
                    onClick={() => reorder(-1)}
                  >
                    <ArrowDown size={18} />
                  </IconButton>
                  <IconButton
                    label="Duplicate layer"
                    disabled={current.lockMode === 'full'}
                    onClick={() => {
                      const layer = { ...current, id: uuid() };
                      change({ ...slide, layers: [...slide.layers, layer] });
                      setSelected(layer.id);
                    }}
                  >
                    <Copy size={18} />
                  </IconButton>
                </div>
              </PropertySection>
            </fieldset>
          ) : (
            <p className="property-empty">
              Select a layer to edit its properties.
            </p>
          )}
        </aside>
      </div>
      <Modal
        title={
          media && typeof media === 'object' ? 'Replace image' : 'Add an image'
        }
        description="Choose an image from your media library."
        open={media !== null}
        onClose={() => setMedia(null)}
        wide
      >
        <MediaLibrary
          assets={assets}
          folders={folders}
          onRefresh={onRefresh}
          onUpload={onUpload}
          shareWithSlideId={slide.id}
          onPick={(asset) => chooseImage(asset.id)}
        />
      </Modal>
      <Modal
        title="Save changes before leaving?"
        destructive
        description="Save this slide, discard the changes, or keep editing."
        open={navigation.confirmOpen}
        onClose={() => {
          if (!busy) navigation.cancel();
        }}
      >
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button disabled={busy} onClick={navigation.cancel}>
            Keep editing
          </button>
          <button disabled={busy} className="danger" onClick={navigation.leave}>
            Discard changes
          </button>
          <button
            className="primary"
            disabled={busy || !slide.name.trim()}
            onClick={() => {
              void save().then((ok) => {
                if (ok) navigation.leave();
              });
            }}
          >
            <Save size={16} />
            Save and continue
          </button>
        </div>
      </Modal>
    </div>
  );
}

type PlaylistShareChange = {
  kind: 'slide' | 'asset';
  id: string;
  name: string;
  target: { userId: string; groupId: string };
  targetLabel: string;
  canShare: boolean;
};

function PlaylistEditor({
  initial,
  slides,
  assets,
  onClose,
  onSave,
  onSharePlan,
  onShare,
  onPublish,
  onPreview,
}: {
  initial: Playlist;
  slides: Slide[];
  assets: Asset[];
  onClose: () => void;
  onSave: (p: Playlist) => Promise<Playlist>;
  onSharePlan: (p: Playlist) => Promise<PlaylistShareChange[]>;
  onShare: (
    id: string,
    changes: Pick<PlaylistShareChange, 'kind' | 'id' | 'target'>[],
  ) => Promise<unknown>;
  onPublish: (p: Playlist) => Promise<Playlist>;
  onPreview: (id: string) => void;
}) {
  const [p, setP] = useState<Playlist>(structuredClone(initial));
  const [duplicateSlide, setDuplicateSlide] = useState<Slide | null>(null);
  const [scheduleNow, setScheduleNow] = useState(Date.now);
  const hasSchedule = p.items.some(
    (item) =>
      item.scheduleEnabled !== false && (item.startsAt || item.expiresAt),
  );
  useEffect(() => {
    if (!hasSchedule) return;
    setScheduleNow(Date.now());
    const timer = setInterval(() => setScheduleNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasSchedule]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shareChanges, setShareChanges] = useState<
    PlaylistShareChange[] | null
  >(null);
  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState({
    publish: false,
    preview: false,
  });
  const [tab, setTab] = useState('sequence');
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(p) !== saved;
  const navigation = useUnsavedNavigation(dirty, onClose);
  function shareKey(change: PlaylistShareChange) {
    return `${change.kind}:${change.id}:${change.target.userId}:${change.target.groupId}`;
  }
  async function action(
    publish = false,
    preview = false,
    acceptedChanges?: PlaylistShareChange[],
  ) {
    setBusy(true);
    setError('');
    try {
      if (acceptedChanges) {
        await onShare(
          p.id,
          acceptedChanges
            .filter((change) => selectedShares.has(shareKey(change)))
            .map(({ kind, id, target }) => ({ kind, id, target })),
        );
        setShareChanges(null);
      } else {
        const changes = await onSharePlan(p);
        if (changes.length) {
          setShareChanges(changes);
          setSelectedShares(
            new Set(changes.filter((change) => change.canShare).map(shareKey)),
          );
          setPendingAction({ publish, preview });
          return false;
        }
      }
      const result = await (publish ? onPublish(p) : onSave(p));
      setP(result);
      setSaved(JSON.stringify(result));
      setMessage(
        publish
          ? 'Published. Screens will download this version on their next sync.'
          : 'Playlist saved.',
      );
      if (preview) onPreview(result.id);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, offset: number) {
    const items = [...p.items];
    const to = index + offset;
    if (to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]];
    setP({ ...p, items });
  }
  function addSlide(slide: Slide, confirmed = false) {
    if (!confirmed && p.items.some((item) => item.slideId === slide.id)) {
      setDuplicateSlide(slide);
      return;
    }
    setP((current) => ({
      ...current,
      items: [...current.items, { slideId: slide.id, duration: 10 }],
    }));
    setMessage(`Added ${slide.name}`);
    setDuplicateSlide(null);
  }
  return (
    <>
      <Modal
        title="Edit playlist"
        description="Arrange slides and set their duration."
        open
        onClose={() => {
          if (!busy) navigation.requestLeave();
        }}
        wide
      >
        <div className="playlist-fields" inert={busy}>
          <label>
            Playlist name
            <input
              value={p.name}
              maxLength={100}
              onChange={(e) => setP({ ...p, name: e.target.value })}
            />
          </label>
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList>
              <TabsTrigger value="sequence">
                Sequence ({p.items.length})
              </TabsTrigger>
              <TabsTrigger value="library">Add slides</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="playlist-transition">
            <label>
              Transition
              <select
                aria-label="Transition"
                value={p.transition?.type || 'cut'}
                onChange={(e) =>
                  setP({
                    ...p,
                    transition: {
                      durationMs: p.transition?.durationMs ?? 500,
                      type: e.target.value as NonNullable<
                        Playlist['transition']
                      >['type'],
                    },
                  })
                }
              >
                <option value="cut">Cut</option>
                <option value="fade">Fade</option>
                <option value="slide-left">Slide left</option>
                <option value="slide-right">Slide right</option>
              </select>
            </label>
            {p.transition && p.transition.type !== 'cut' && (
              <label>
                <span className="transition-duration-label">
                  Duration{' '}
                  <output>
                    {(p.transition.durationMs / 1000).toFixed(1)} s
                  </output>
                </span>
                <input
                  aria-label="Transition duration"
                  type="range"
                  min={200}
                  max={2000}
                  step={100}
                  value={p.transition.durationMs}
                  aria-valuetext={`${(p.transition.durationMs / 1000).toFixed(1)} seconds`}
                  onChange={(e) =>
                    setP({
                      ...p,
                      transition: {
                        ...p.transition!,
                        durationMs: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            )}
          </div>
          {tab === 'sequence' ? (
            <div className="sequence">
              {p.items.length ? (
                p.items.map((item, index) => {
                  const slide = slides.find((s) => s.id === item.slideId);
                  const availability = playlistItemStatus(item, scheduleNow);
                  const statusDate = availability.at
                    ? new Date(availability.at)
                    : null;
                  const statusLabel =
                    availability.state === 'active'
                      ? 'Active'
                      : availability.state === 'invalid'
                        ? 'Check schedule'
                        : `${availability.state === 'scheduled' ? 'Starts' : 'Deactivated'} ${statusDate!.toLocaleString(
                            [],
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            },
                          )}`;
                  return (
                    <div
                      className="sequence-row"
                      key={`${index}-${item.slideId}`}
                    >
                      <span className="sequence-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="sequence-thumb">
                        {slide && <SlideCanvas slide={slide} assets={assets} />}
                      </div>
                      <div className="sequence-details">
                        <strong>{slide?.name || 'Missing slide'}</strong>
                        <span
                          className={`sequence-status ${availability.state}`}
                          title={statusDate?.toString()}
                        >
                          {availability.state === 'active' ? (
                            <CheckCircle2 size={13} aria-hidden="true" />
                          ) : availability.state === 'scheduled' ? (
                            <Clock size={13} aria-hidden="true" />
                          ) : (
                            <Circle size={13} aria-hidden="true" />
                          )}
                          <span>{statusLabel}</span>
                        </span>
                      </div>
                      <div className="sequence-controls">
                        <label
                          className="sequence-toggle"
                          htmlFor={`schedule-${index}`}
                        >
                          Schedule
                          <Switch
                            id={`schedule-${index}`}
                            aria-label={`Schedule slide ${index + 1}`}
                            checked={
                              item.scheduleEnabled ??
                              Boolean(item.startsAt || item.expiresAt)
                            }
                            onCheckedChange={(scheduleEnabled) =>
                              setP({
                                ...p,
                                items: p.items.map((entry, i) =>
                                  i === index
                                    ? { ...entry, scheduleEnabled }
                                    : entry,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="duration-input">
                          <input
                            aria-label={`Duration for slide ${index + 1}`}
                            type="number"
                            min={2}
                            max={3600}
                            value={item.duration}
                            onChange={(e) =>
                              setP({
                                ...p,
                                items: p.items.map((v, i) =>
                                  i === index
                                    ? {
                                        ...v,
                                        duration: Math.max(
                                          2,
                                          Math.min(
                                            3600,
                                            Number(e.target.value),
                                          ),
                                        ),
                                      }
                                    : v,
                                ),
                              })
                            }
                          />
                          <span>sec</span>
                        </label>
                        <div className="row-actions">
                          <IconButton
                            label={`Move slide ${index + 1} up`}
                            disabled={!index}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={16} />
                          </IconButton>
                          <IconButton
                            label={`Move slide ${index + 1} down`}
                            disabled={index === p.items.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={16} />
                          </IconButton>
                          <IconButton
                            label={`Remove slide ${index + 1}`}
                            onClick={() =>
                              setP({
                                ...p,
                                items: p.items.filter((_, i) => i !== index),
                              })
                            }
                          >
                            <X size={16} />
                          </IconButton>
                        </div>
                      </div>
                      {(item.scheduleEnabled ??
                        Boolean(item.startsAt || item.expiresAt)) && (
                        <div className="sequence-schedule">
                          {(['startsAt', 'expiresAt'] as const).map((field) => (
                            <label key={field}>
                              {field === 'startsAt'
                                ? 'Starts at'
                                : 'Expires at'}
                              <input
                                type="datetime-local"
                                step="1"
                                aria-label={`${field === 'startsAt' ? 'Starts at' : 'Expires at'} for slide ${index + 1}`}
                                value={
                                  item[field] ? localDateTime(item[field]) : ''
                                }
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (
                                    value &&
                                    !Number.isFinite(new Date(value).getTime())
                                  )
                                    return;
                                  setP({
                                    ...p,
                                    items: p.items.map((entry, i) =>
                                      i === index
                                        ? {
                                            ...entry,
                                            [field]: value
                                              ? new Date(value).toISOString()
                                              : null,
                                          }
                                        : entry,
                                    ),
                                  });
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="small-empty">
                  <ListVideo size={28} />
                  <p>No slides in this playlist.</p>
                  <button onClick={() => setTab('library')}>
                    <Plus size={16} />
                    Add slides
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="add-slide-grid">
              {slides.map((s) => {
                const count = p.items.filter(
                  (item) => item.slideId === s.id,
                ).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-added={count > 0}
                    aria-label={
                      count ? `Add another copy of ${s.name}` : `Add ${s.name}`
                    }
                    aria-haspopup={count ? 'dialog' : undefined}
                    onClick={() => addSlide(s)}
                  >
                    <SlideCanvas slide={s} assets={assets} />
                    <span>
                      <span className="add-slide-info">
                        <strong>{s.name}</strong>
                        <span
                          className={`add-slide-status ${count ? 'added' : ''}`}
                        >
                          {count ? (
                            <>
                              <CheckCircle2 size={13} aria-hidden="true" />
                              In playlist{count > 1 ? ` (${count})` : ''}
                            </>
                          ) : (
                            'Not added'
                          )}
                        </span>
                      </span>
                      <Plus size={16} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
              {!slides.length && <p>Create a slide first.</p>}
            </div>
          )}
          <div className="playlist-total">
            <span>{p.items.length} slides</span>
            <strong>{playlistDuration(p)} seconds / loop</strong>
          </div>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {message && <output className="success-message">{message}</output>}
        <div className="dialog-actions">
          <IconButton
            label="Preview saved playlist"
            disabled={busy || !p.items.length}
            onClick={() => action(false, true)}
          >
            <Play size={18} />
          </IconButton>
          <button disabled={busy || !p.name.trim()} onClick={() => action()}>
            <Save size={16} />
            Save draft
          </button>
          <button
            className="primary"
            disabled={busy || !p.items.length || !p.name.trim()}
            onClick={() => action(true)}
          >
            <Check size={17} />
            Publish playlist
          </button>
        </div>
      </Modal>
      <Modal
        title="Add this slide again?"
        description={`"${duplicateSlide?.name || ''}" is already in this playlist. Add another entry?`}
        destructive
        open={!!duplicateSlide}
        onClose={() => setDuplicateSlide(null)}
      >
        <div className="dialog-actions">
          <button onClick={() => setDuplicateSlide(null)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              if (duplicateSlide) addSlide(duplicateSlide, true);
            }}
          >
            <Copy size={16} />
            Add another copy
          </button>
        </div>
      </Modal>
      <Modal
        title="Share referenced content?"
        description="These slides and media need access for the playlist owner and its recipients. All listed changes are required to continue."
        open={shareChanges !== null}
        onClose={() => !busy && setShareChanges(null)}
      >
        <div className="playlist-share-changes">
          {shareChanges?.map((change) => {
            const key = shareKey(change);
            return (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={selectedShares.has(key)}
                  disabled={!change.canShare || busy}
                  onChange={(event) =>
                    setSelectedShares((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                <span>
                  Share <strong>{change.name}</strong> ({change.kind}) with{' '}
                  <strong>{change.targetLabel}</strong>
                  {!change.canShare && ' — only its owner can share this item'}
                </span>
              </label>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => setShareChanges(null)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              shareChanges?.some(
                (change) =>
                  !change.canShare || !selectedShares.has(shareKey(change)),
              )
            }
            onClick={() =>
              void action(
                pendingAction.publish,
                pendingAction.preview,
                shareChanges || [],
              )
            }
          >
            {busy ? 'Sharing…' : 'Accept'}
          </button>
        </div>
      </Modal>
      <Modal
        title="Save playlist before leaving?"
        destructive
        description="Save the draft, discard changes, or keep editing."
        open={navigation.confirmOpen}
        onClose={() => {
          if (!busy) navigation.cancel();
        }}
      >
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button disabled={busy} onClick={navigation.cancel}>
            Keep editing
          </button>
          <button disabled={busy} className="danger" onClick={navigation.leave}>
            Discard
          </button>
          <button
            className="primary"
            disabled={busy || !p.name.trim()}
            onClick={() => {
              void action().then((ok) => {
                if (ok) navigation.leave();
              });
            }}
          >
            <Save size={16} />
            Save and continue
          </button>
        </div>
      </Modal>
    </>
  );
}
