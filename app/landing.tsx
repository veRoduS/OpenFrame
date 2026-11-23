import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CodeXml,
  Copy,
  Download,
  GitFork,
  Menu,
  Monitor,
  Pause,
  Play,
  Plus,
  Server,
  Tag,
  WifiOff,
  X,
} from 'lucide-react';
import './landing.css';
import { ANDROID_GITHUB_APK } from '../server/android-release-config.mjs';
import { clockText, nextClockDelay } from '../player/web/clock.js';

const repository = 'https://github.com/veRoduS/OpenFrame';
const commands = [
  ['git clone', 'https://github.com/veRoduS/OpenFrame.git'],
  ['cd', 'OpenFrame'],
  ['docker compose', 'up -d --build'],
];
const install = commands.map((command) => command.join(' ')).join('\n');

// The sample playlist every screen on this page plays. tests/landing.browser.mjs
// seeds the same four slides for the workspace captures further down.
const slides = [
  {
    name: 'Welcome to the studio',
    tone: 'forest',
    label: 'THE COMMUNITY STUDIO',
    lines: ['Make something', 'good.'],
    detail: 'Workshops  /  Talks  /  Good company',
  },
  {
    name: 'This week, together',
    tone: 'lavender',
    label: 'ON THE CALENDAR',
    lines: ['A little time.', 'A new perspective.'],
    detail: 'Tuesday  /  Open studio  /  6 pm',
  },
  {
    name: 'Coffee & conversation',
    tone: 'coral',
    label: 'SLOW DOWN. STAY A WHILE.',
    lines: ['Good coffee.', 'Better company.'],
    detail: 'Every morning  /  From 8 am',
    clock: true,
  },
  {
    name: 'A moment to recharge',
    tone: 'sage',
    label: 'A LITTLE REMINDER',
    lines: ['Great things take', 'a little space.'],
    detail: 'See you in the courtyard.',
  },
];
const clockSlide = slides.findIndex((slide) => slide.clock);
const slideMs = 6000;

// The hero photograph, and the inner edge of the display hanging in it,
// measured in image pixels. The left and right edges are vertical; the top and
// bottom converge towards the right.
const scene = { width: 1672, height: 941, focusX: 1125, focusY: 445 };
const wall = {
  left: 797,
  right: 1452.6,
  top: [116.3, 157.9],
  bottom: [534.9, 528.2],
};
const frame = { width: 960, height: 540 };
// Projects the flat 960 x 540 frame onto that display, so the playlist appears
// to play inside the photograph.
const wallTransform = (() => {
  const d = (wall.bottom[0] - wall.top[0]) / (wall.bottom[1] - wall.top[1]);
  const a = (wall.right * d - wall.left) / frame.width;
  const b = (wall.top[1] * d - wall.top[0]) / frame.width;
  const e = (wall.bottom[0] - wall.top[0]) / frame.height;
  const g = (d - 1) / frame.width;
  return `matrix3d(${a},${b},0,${g},0,${e},0,0,0,0,1,0,${wall.left},${wall.top[0]},0,1)`;
})();

const facts = [
  [CodeXml, 'Open source', 'MIT licensed, built in the open'],
  [Server, 'Hosted by you', 'Runs in Docker on your server'],
  [Tag, 'No per-screen fees', 'Free for every screen you add'],
  [WifiOff, 'Keeps playing offline', 'Each player holds a local copy'],
] as const;

const steps = [
  {
    tone: 'sage',
    label: 'Create',
    title: 'Start with an idea.',
    text: 'Place text, images, and video on a canvas. Crop the perfect detail, then add a clock, a countdown, or local weather.',
    image: '/images/openframe-editor.webp',
    alt: 'The OpenFrame slide editor with a welcome slide open, its headline selected, and layers and text properties on either side',
    width: 2560,
    height: 1600,
  },
  {
    tone: 'lavender',
    label: 'Set the rhythm',
    title: 'Give it a place in the day.',
    text: 'Line slides up in a playlist, decide how long each one stays, add start and end dates, and publish when you’re ready.',
    image: '/images/openframe-playlist.webp',
    alt: 'A playlist sequence of four sample slides, each with its own duration and schedule switch',
    width: 1464,
    height: 1098,
  },
  {
    tone: 'coral',
    label: 'Put it on screen',
    title: 'Pair a screen and let it play.',
    text: 'Approve a pairing code, assign a playlist, and see at a glance what’s connected. Blank, refresh, or restart a screen from your desk.',
    image: '/images/openframe-screens.webp',
    alt: 'A connected screen named Courtyard, playing its assigned playlist, with rotation, blanking, and restart controls',
    width: 1012,
    height: 760,
  },
];

const devices = [
  { name: 'Front desk', kind: 'Raspberry Pi' },
  { name: 'Courtyard', kind: 'Android TV' },
  { name: 'Down the road', kind: 'Raspberry Pi', offline: true },
];

const questions = [
  [
    'Where does my content live?',
    'On your own server. OpenFrame runs in Docker and stores your slides, media, and settings in a persistent data volume. You decide where to host it and how to back it up.',
  ],
  [
    'What happens when a screen goes offline?',
    'A configured player keeps playing its last synced playlist and retries the server connection. New content arrives when the connection returns.',
  ],
  [
    'Can I manage screens at another location?',
    'Yes. Players can reach your server through a public HTTPS address, a Cloudflare Tunnel, or WireGuard. Screen pairing and individual device credentials control access.',
  ],
  [
    'Which Raspberry Pi should I use?',
    'The player is designed for lightweight Raspberry Pi devices, including the Pi 4, Pi 5, and Zero 2 W. The project is pre-1.0; physical-device playback and Wi-Fi testing are still in progress. Check the installation guide before choosing hardware.',
  ],
  [
    'Can my team use it too?',
    'Yes. Individual accounts, assigned screens, and nested groups let you share slides, playlists, and media. Membership and resource access are configured separately for each group, and every user manages their own password.',
  ],
];

// One timer while the page is visible and the playlist is playing; none
// otherwise. Reduced-motion visitors start paused and can step through.
function usePlaylist() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const running = playing && visible;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % slides.length),
      slideMs,
    );
    return () => window.clearTimeout(timer);
  }, [running, index]);
  return { index, setIndex, playing, setPlaying, running, visible };
}

// The clock slide uses the player's own formatter and minute alignment, and
// only keeps time while that slide is on a visible page.
function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, nextClockDelay({}, Date.now()) + 50);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active]);
  return clockText({}, now);
}

// Fits the photograph to its frame like object-fit: cover, keeps the display in
// view, and reports where the display ended up so the caption can sit below it.
function useScene() {
  const hero = useRef<HTMLElement>(null);
  const view = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hero.current;
    const element = view.current;
    if (!host || !element) return;
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const fill = Number(
        getComputedStyle(element).getPropertyValue('--screen-fill') || 0,
      );
      const scale = Math.max(
        width / scene.width,
        height / scene.height,
        (fill * width) / (wall.right - wall.left),
      );
      const offset = (size: number, full: number, focus: number) =>
        Math.min(0, Math.max(size - full * scale, size / 2 - focus * scale));
      const x = offset(width, scene.width, scene.focusX);
      const y = offset(height, scene.height, scene.focusY);
      host.style.setProperty('--scene-scale', String(scale));
      host.style.setProperty('--scene-x', `${x}px`);
      host.style.setProperty('--scene-y', `${y}px`);
      host.style.setProperty('--wall-x', `${x + wall.left * scale}px`);
      host.style.setProperty('--wall-y', `${y + wall.bottom[0] * scale}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { hero, view };
}

function Screen({ index, time }: { index: number; time: string }) {
  return (
    <div className="landing-screen" aria-hidden="true">
      {slides.map((slide, position) => (
        <div
          key={slide.name}
          className={`landing-slide tone-${slide.tone}${position === index ? ' is-current' : ''}`}
        >
          <span className="landing-slide-label">{slide.label}</span>
          {slide.clock && <span className="landing-slide-clock">{time}</span>}
          <strong className="landing-slide-headline">
            {slide.lines[0]}
            <br />
            {slide.lines[1]}
          </strong>
          <span className="landing-slide-detail">{slide.detail}</span>
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const { index, setIndex, playing, setPlaying, running, visible } =
    usePlaylist();
  const time = useClock(visible && index === clockSlide);
  const { hero, view } = useScene();
  // A TV cannot reach this server through a loopback address.
  const local = /^(localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(install);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('Clipboard unavailable. Select the commands to copy them.');
    }
  }
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-wrap landing-header-inner">
          <a href="/" className="landing-brand" aria-label="OpenFrame home">
            <span className="landing-brand-mark">
              <Monitor size={20} strokeWidth={1.9} />
            </span>
            OpenFrame<span className="landing-brand-dot">.</span>
          </a>
          <nav
            id="landing-nav"
            className={menuOpen ? 'landing-nav is-open' : 'landing-nav'}
            aria-label="Main navigation"
          >
            <a href="#overview" onClick={closeMenu}>
              Overview
            </a>
            <a href="#your-server" onClick={closeMenu}>
              Your setup
            </a>
            <a href="#android-player" onClick={closeMenu}>
              Android player
            </a>
            <a href={`${repository}/tree/main/docs`}>
              Documentation <ArrowUpRight size={15} />
            </a>
          </nav>
          <div className="landing-header-actions">
            <a href="/login" className="landing-login">
              Log in <ArrowRight size={16} />
            </a>
            <button
              type="button"
              className="landing-menu"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              aria-controls="landing-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content">
        <section
          className="landing-hero"
          aria-labelledby="landing-title"
          ref={hero}
        >
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span className="landing-eyebrow-dot" />
              Open-source digital signage
            </p>
            <h1 id="landing-title">
              <span>Your screens.</span>{' '}
              <span>Your little corner of the world.</span>
            </h1>
            <p className="landing-hero-text">
              OpenFrame is digital signage you host yourself. Design slides,
              line them up in playlists, and keep every screen playing, even
              when the connection drops.
            </p>
            <div className="landing-actions">
              <a href="#get-started" className="landing-button">
                Get started <ArrowRight size={18} />
              </a>
              <a href="#overview" className="landing-link">
                See how it works <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <div className="landing-scene" ref={view}>
            <div className="landing-scene-canvas">
              <img
                className="landing-scene-photo"
                src="/images/openframe-studio.webp"
                alt="A large display on the wall of a sunlit community studio, above a bench and beside a window"
                width={scene.width}
                height={scene.height}
                fetchPriority="high"
              />
              <div
                className="landing-wall"
                style={{ transform: wallTransform }}
              >
                <Screen index={index} time={time} />
              </div>
            </div>
          </div>
          <fieldset className="landing-playing" aria-label="Sample playlist">
            <div className={running ? 'is-running' : undefined}>
              <button
                type="button"
                className="landing-playing-toggle"
                aria-label={
                  playing ? 'Pause sample playlist' : 'Play sample playlist'
                }
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <p className="landing-playing-title">
                <span>Now playing</span>
                <strong>{slides[index].name}</strong>
              </p>
              <div className="landing-playing-slides">
                {slides.map((slide, position) => (
                  <button
                    type="button"
                    key={slide.name}
                    className={position === index ? 'is-current' : undefined}
                    aria-label={`Show slide ${position + 1}: ${slide.name}`}
                    aria-pressed={position === index}
                    onClick={() => setIndex(position)}
                  >
                    <i key={`${position === index}-${running}`} />
                  </button>
                ))}
              </div>
            </div>
          </fieldset>
          <p className="landing-hero-credit">
            A sample playlist, playing in an illustrated space.
          </p>
        </section>
        <ul className="landing-facts" aria-label="Project highlights">
          {facts.map(([Icon, title, text]) => (
            <li key={title}>
              <Icon size={20} strokeWidth={1.7} />
              <p>
                <strong>{title}</strong>
                <span>{text}</span>
              </p>
            </li>
          ))}
        </ul>
        <section id="overview" className="landing-section landing-wrap">
          <div className="landing-heading">
            <div>
              <p className="landing-eyebrow">A good message goes a long way</p>
              <h2>From a blank canvas to a room full of possibilities.</h2>
            </div>
            <p className="landing-lead">
              A welcome at the front door. The menu of the day. Something worth
              stopping for. Put it on screen, then get on with your day.
            </p>
          </div>
          <ol className="landing-steps">
            {steps.map((step, position) => (
              <li key={step.label} className={`landing-step tone-${step.tone}`}>
                <div className="landing-step-copy">
                  <p className="landing-step-label">
                    <span>0{position + 1}</span>
                    {step.label}
                  </p>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                <figure className="landing-step-visual">
                  <img
                    src={step.image}
                    alt={step.alt}
                    width={step.width}
                    height={step.height}
                    loading="lazy"
                  />
                </figure>
              </li>
            ))}
          </ol>
          <p className="landing-note">
            The real workspace, shown with sample content.
          </p>
        </section>
        <section id="your-server" className="landing-setup">
          <div className="landing-wrap landing-setup-inner">
            <div className="landing-setup-copy">
              <p className="landing-eyebrow">Small hardware. Your big ideas.</p>
              <h2>At home on your network.</h2>
              <p className="landing-lead">
                A Docker server behind the scenes. A Raspberry Pi or Android TV
                behind the screen. Your content, right where it belongs.
              </p>
              <a
                href={`${repository}/blob/main/docs/player-installation.md`}
                className="landing-link"
              >
                Meet the player <ArrowRight size={17} />
              </a>
            </div>
            <figure className="landing-network">
              <div className="landing-network-server">
                <span className="landing-network-icon">
                  <Server size={24} strokeWidth={1.7} />
                </span>
                <p>
                  <strong>Your server</strong>
                  <span>OpenFrame in Docker</span>
                </p>
                <span className="landing-network-tag">Your content</span>
              </div>
              <p className="landing-network-links">
                <span>Paired. Published. Synced.</span>
                <i />
                <i />
                <i />
              </p>
              <ul className="landing-network-screens">
                {devices.map((device) => (
                  <li
                    key={device.name}
                    className={device.offline ? 'is-offline' : undefined}
                  >
                    <div className="landing-device">
                      <Screen index={index} time={time} />
                    </div>
                    <strong>{device.name}</strong>
                    <span>{device.kind}</span>
                    <small>
                      {device.offline ? (
                        <WifiOff size={13} />
                      ) : (
                        <Check size={13} />
                      )}
                      {device.offline ? 'Playing offline' : 'Local copy ready'}
                    </small>
                  </li>
                ))}
              </ul>
              <figcaption className="landing-network-caption">
                An interrupted connection doesn’t have to interrupt your
                message.
              </figcaption>
            </figure>
          </div>
        </section>
        <section
          id="get-started"
          className="landing-section landing-wrap landing-start"
        >
          <div className="landing-start-copy">
            <p className="landing-eyebrow">
              Your next side project, on display
            </p>
            <h2>Give OpenFrame a place to live.</h2>
            <p className="landing-lead">
              Bring a server and a little curiosity. The source, setup guides,
              and next steps are all out in the open.
            </p>
            <div className="landing-actions">
              <a href={repository} className="landing-button">
                <GitFork size={18} /> Get OpenFrame
              </a>
              <a
                href={`${repository}/blob/main/docs/quick-start.md`}
                className="landing-link"
              >
                Read the setup guide <ArrowRight size={16} />
              </a>
            </div>
            <p className="landing-note">
              Pre-1.0 and growing. Built in the open.
            </p>
          </div>
          <div>
            <div className="landing-terminal">
              <div className="landing-terminal-bar">
                <span>The first three lines</span>
                <button
                  type="button"
                  title={copied ? 'Commands copied' : 'Copy install commands'}
                  aria-label={
                    copied ? 'Commands copied' : 'Copy install commands'
                  }
                  onClick={() => void copyInstall()}
                >
                  {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
                  <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre>
                <code>
                  {commands.map(([command, rest]) => (
                    <span key={command}>
                      <b>{command}</b> {rest}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
              <output className="landing-copy-status">
                {copyError || (copied ? 'Copied to clipboard.' : '')}
              </output>
            </div>
            <ol className="landing-next">
              <li>
                <strong>Find your first password.</strong> Run{' '}
                <code>docker compose logs openframe</code>. Each install prints
                its own.
              </li>
              <li>
                <strong>Sign in.</strong> Open <code>localhost:3100</code>,
                choose Log in, and use <code>admin</code>.
              </li>
              <li>
                <strong>Go live.</strong> Make a slide, publish a playlist, and
                pair your first screen.
              </li>
            </ol>
          </div>
        </section>
        <section
          id="android-player"
          className="landing-android"
          aria-labelledby="android-player-title"
        >
          <div className="landing-wrap landing-android-inner">
            <div>
              <p className="landing-eyebrow">OpenFrame on Android TV</p>
              <h2 id="android-player-title">Put your TV to work.</h2>
              <p className="landing-lead">
                The Android player turns a TV or streaming box into an OpenFrame
                screen. No Play Store account, and nothing else to install on
                the box.
              </p>
              <a className="landing-button" href={ANDROID_GITHUB_APK}>
                <Download size={18} /> Download latest Android APK
              </a>
              <p className="landing-note">
                Android 9+ and WebView 100+. Experimental player. Updates are
                checked in the app; Android asks you to approve installation.
              </p>
            </div>
            <div className="landing-pairing">
              <ol className="landing-next">
                <li>
                  <strong>Get the app onto your TV.</strong> Download it there
                  with a downloader app, or transfer it over Wi-Fi or USB.
                </li>
                <li>
                  <strong>Enter this server’s address.</strong>{' '}
                  {local
                    ? 'Use its network address rather than localhost, in this form:'
                    : 'Open OpenFrame Player and type:'}
                  <code className="landing-address">
                    {local ? 'http://192.168.1.10:3100' : location.origin}
                  </code>
                </li>
                <li>
                  <strong>Approve the pairing code.</strong> Open Screens in
                  your workspace, approve the code, and assign a playlist.
                </li>
              </ol>
              <a
                className="landing-link"
                href={`${repository}/blob/main/docs/android-tv.md`}
              >
                Installation guide <ArrowRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section
          className="landing-section landing-wrap landing-questions"
          aria-labelledby="questions-title"
        >
          <div>
            <p className="landing-eyebrow">
              A few things you might be wondering
            </p>
            <h2 id="questions-title">Before you plug in.</h2>
          </div>
          <div>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <Plus size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-closing">
          <div className="landing-closing-strip" aria-hidden="true">
            {slides.map((slide, position) => (
              <span
                key={slide.name}
                className={`tone-${slide.tone}${position === index ? ' is-current' : ''}`}
              />
            ))}
          </div>
          <p className="landing-eyebrow">Make something worth sharing</p>
          <h2>Every screen is an opportunity.</h2>
          <a href="/login" className="landing-button">
            Open your workspace <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-inner">
          <a className="landing-brand" href="/" aria-label="OpenFrame home">
            <span className="landing-brand-mark">
              <Monitor size={18} strokeWidth={1.9} />
            </span>
            OpenFrame<span className="landing-brand-dot">.</span>
          </a>
          <p>Open source. On your network. Under your control.</p>
          <nav aria-label="Footer">
            <a href={repository}>
              GitHub <ArrowUpRight size={14} />
            </a>
            <a href={`${repository}/tree/main/docs`}>Documentation</a>
            <a href={`${repository}/blob/main/LICENSE`}>MIT license</a>
            <a href="/login">Log in</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
