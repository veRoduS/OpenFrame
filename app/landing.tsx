import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  GitFork,
  Layers,
  Menu,
  Monitor,
  Play,
  Server,
  ShieldCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import './landing.css';

const repository = 'https://github.com/veRoduS/OpenFrame';
const install =
  'git clone https://github.com/veRoduS/OpenFrame.git\ncd OpenFrame\ndocker compose up -d --build';
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
    'Yes. Individual accounts, assigned screens, and groups let you share slides, playlists, and media. Each group has an admin, and every user manages their own password.',
  ],
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [androidRelease, setAndroidRelease] = useState<{
    versionName: string;
    apkUrl: string;
  } | null>(null);
  const [androidLoading, setAndroidLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch('/downloads/android/latest.json', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const release = await response.json();
        if (
          release.available &&
          /^\d+\.\d+\.\d+$/.test(release.versionName) &&
          release.apkUrl ===
            `/downloads/android/openframe-player-${release.versionName}.apk`
        )
          setAndroidRelease(release);
      })
      .catch(() => {
        /* The page remains usable before an APK is published. */
      })
      .finally(() => {
        clearTimeout(timeout);
        setAndroidLoading(false);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(install);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('Clipboard unavailable. Select the commands to copy them.');
    }
  }
  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header">
        <a href="/" className="landing-brand" aria-label="OpenFrame home">
          <span>
            <Monitor size={23} strokeWidth={1.7} />
          </span>
          OpenFrame<span className="landing-wordmark-dot">.</span>
        </a>
        <nav
          className={menuOpen ? 'landing-nav is-open' : 'landing-nav'}
          aria-label="Main navigation"
        >
          <a href="#overview" onClick={() => setMenuOpen(false)}>
            Overview
          </a>
          <a href="#your-server" onClick={() => setMenuOpen(false)}>
            Your setup
          </a>
          <a href="#android-player" onClick={() => setMenuOpen(false)}>
            Android player
          </a>
          <a href={`${repository}/tree/main/docs`}>
            Documentation <ArrowRight size={13} />
          </a>
        </nav>
        <div className="landing-nav-actions">
          <a href="/login" className="landing-login">
            Log in <ArrowRight size={16} />
          </a>
          <button
            className="landing-menu"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>
      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <img
            className="landing-hero-image"
            src="/images/openframe-studio.webp"
            alt="A digital display showing a community studio poster in a sunlit gallery"
            width={1672}
            height={941}
            fetchPriority="high"
          />
          <div className="landing-hero-content">
            <span className="landing-eyebrow">
              <span className="landing-live-dot" /> OPEN SOURCE. ON YOUR TERMS.
            </span>
            <h1 id="landing-title">
              OpenFrame<span>.</span>
            </h1>
            <p className="landing-hero-line">
              Your screens.
              <br /> Your little corner of the world.
            </p>
            <p className="landing-hero-description">
              Bring your spaces to life with digital signage you own. Create,
              schedule, and share from your own server.
            </p>
            <div className="landing-hero-actions">
              <a href="#get-started" className="landing-button">
                Make it yours <ArrowRight size={18} />
              </a>
              <a href="#overview" className="landing-text-link">
                Take a look <ArrowDown size={16} />
              </a>
            </div>
            <span className="landing-hero-note">
              Self-hosted. MIT licensed. No per-screen fees.
            </span>
          </div>
          <span className="landing-photo-label">
            A little inspiration for your next screen.
          </span>
        </section>
        <div className="landing-principles" aria-label="Project highlights">
          <span>
            <GitFork size={19} /> Open by design
          </span>
          <span>
            <Server size={19} /> Hosted by you
          </span>
          <span>
            <Monitor size={19} /> Made for real spaces
          </span>
          <span>
            <WifiOff size={19} /> Keeps playing offline
          </span>
        </div>
        <section id="overview" className="landing-overview landing-section">
          <div className="landing-section-heading">
            <div>
              <span className="landing-eyebrow">
                A GOOD MESSAGE GOES A LONG WAY
              </span>
              <h2>
                From a blank canvas
                <br />
                to a room full of possibilities.
              </h2>
            </div>
            <p>
              A welcome at the front door. The menu of the day. Something worth
              stopping for. Put it on screen, then get on with your day.
            </p>
          </div>
          <figure className="landing-product">
            <div className="landing-product-bar">
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>
                <ShieldCheck size={13} /> Your OpenFrame workspace
              </span>
              <span className="landing-product-label">SAMPLE CONTENT</span>
            </div>
            <img
              src="/images/openframe-workspace.webp"
              width={1440}
              height={900}
              loading="lazy"
              alt="OpenFrame slide library with editable community notices and scheduled display content"
            />
            <figcaption>
              One place for the things you want to put out into the world.
            </figcaption>
          </figure>
          <div className="landing-features">
            <article>
              <span className="landing-feature-icon">
                <Layers size={24} />
              </span>
              <span className="landing-number">01 / CREATE</span>
              <h3>Start with an idea.</h3>
              <p>
                Place text and images, crop the perfect detail, and add clocks,
                counters, or local weather.
              </p>
            </article>
            <article>
              <span className="landing-feature-icon coral">
                <Play size={24} />
              </span>
              <span className="landing-number">02 / SET THE RHYTHM</span>
              <h3>Give it a place in the day.</h3>
              <p>
                Build playlists, set start and end dates, and publish when
                you&apos;re ready. Upcoming slides prepare ahead.
              </p>
            </article>
            <article>
              <span className="landing-feature-icon violet">
                <Users size={24} />
              </span>
              <span className="landing-number">03 / SHARE THE SPACE</span>
              <h3>Bring your people in.</h3>
              <p>
                Give each person a login. Share media and slides in groups, and
                assign the right screens to the right team.
              </p>
            </article>
          </div>
        </section>
        <section id="your-server" className="landing-ownership">
          <div className="landing-ownership-inner">
            <div>
              <span className="landing-eyebrow">
                SMALL HARDWARE. YOUR BIG IDEAS.
              </span>
              <h2>
                At home on
                <br />
                your network.
              </h2>
              <p>
                A Docker server behind the scenes. A Raspberry Pi or Android TV
                behind the screen. Your content, right where it belongs.
              </p>
              <a
                href={`${repository}/blob/main/docs/player-installation.md`}
                className="landing-text-link"
              >
                Meet the player <ArrowRight size={17} />
              </a>
            </div>
            <div
              className="landing-network"
              aria-label="An OpenFrame server sends playlists to paired screens, which keep a local copy"
            >
              <div className="landing-network-source">
                <span>
                  <Server size={28} />
                </span>
                <div>
                  <strong>Your server</strong>
                  <small>OpenFrame in Docker</small>
                </div>
                <span className="landing-network-tag">YOUR CONTENT</span>
              </div>
              <div className="landing-network-path">
                <span>Paired. Published. Synced.</span>
                <ArrowDown size={21} />
              </div>
              <div className="landing-network-screens">
                {['Front desk', 'The studio', 'Down the road'].map(
                  (name, i) => (
                    <div key={name}>
                      <div className={`landing-mini-screen screen-${i}`}>
                        <Monitor size={27} />
                        <span>
                          {i === 0
                            ? 'Welcome in.'
                            : i === 1
                              ? 'Make something.'
                              : 'See you soon.'}
                        </span>
                      </div>
                      <strong>{name}</strong>
                      <small>
                        <Check size={12} /> Local copy ready
                      </small>
                    </div>
                  ),
                )}
              </div>
              <p className="landing-network-caption">
                <WifiOff size={15} /> An interrupted connection doesn&apos;t
                have to interrupt your message.
              </p>
            </div>
          </div>
        </section>
        <section id="get-started" className="landing-start landing-section">
          <div>
            <span className="landing-eyebrow">
              YOUR NEXT SIDE PROJECT, ON DISPLAY
            </span>
            <h2>
              Give OpenFrame
              <br />a place to live.
            </h2>
            <p>
              Bring a server and a little curiosity. The source, setup guides,
              and next steps are all out in the open.
            </p>
            <div className="landing-start-links">
              <a href={repository} className="landing-button">
                <GitFork size={18} /> Get OpenFrame <ArrowRight size={17} />
              </a>
              <a
                href={`${repository}/blob/main/docs/quick-start.md`}
                className="landing-text-link"
              >
                Read the setup guide <ArrowRight size={16} />
              </a>
            </div>
            <span className="landing-release-note">
              Pre-1.0 and growing. Built in the open.
            </span>
          </div>
          <div className="landing-terminal">
            <div>
              <span>
                <span className="landing-terminal-dot" /> THE FIRST THREE LINES
              </span>
              <button
                title={copied ? 'Commands copied' : 'Copy install commands'}
                aria-label={
                  copied ? 'Commands copied' : 'Copy install commands'
                }
                onClick={() => void copyInstall()}
              >
                {copied ? <CheckCheck size={17} /> : <Copy size={17} />}
              </button>
            </div>
            <pre>
              <code>
                <span>git clone</span> https://github.com/veRoduS/OpenFrame.git
                {'\n'}
                <span>cd</span> OpenFrame{'\n'}
                <span>docker compose</span> up -d --build
              </code>
            </pre>
            <p>Docker + Compose, and you&apos;re on your way.</p>
            <output className="landing-copy-status">
              {copyError || (copied ? 'Copied to clipboard.' : '')}
            </output>
          </div>
        </section>
        <section
          className="landing-questions landing-section"
          aria-labelledby="questions-title"
        >
          <div>
            <span className="landing-eyebrow">
              A FEW THINGS YOU MIGHT BE WONDERING
            </span>
            <h2 id="questions-title">Before you plug in.</h2>
          </div>
          <div>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section
          id="android-player"
          className="landing-android"
          aria-labelledby="android-player-title"
        >
          <span className="landing-eyebrow">OPENFRAME ON ANDROID TV</span>
          <h2 id="android-player-title">Put your TV to work.</h2>
          <p>
            Download the player directly on your TV with a downloader app, or
            transfer it over Wi-Fi or USB. Open it, enter this server’s address,
            and pair your screen.
          </p>
          {androidRelease ? (
            <a className="landing-button" href={androidRelease.apkUrl} download>
              <Download size={19} /> Download Android APK ·{' '}
              {androidRelease.versionName}
            </a>
          ) : (
            <output>
              {androidLoading
                ? 'Checking for the Android download…'
                : 'The Android download is not available on this server yet.'}
            </output>
          )}
          <p className="landing-android-details">
            Android 9+ and WebView 100+. Experimental player. Updates are
            checked in the app; Android asks you to approve installation.
          </p>
          <a
            className="landing-text-link"
            href={`${repository}/blob/main/docs/android-tv.md`}
          >
            Installation guide <ArrowRight size={17} />
          </a>
        </section>
        <section className="landing-closing">
          <span className="landing-eyebrow">MAKE SOMETHING WORTH SHARING</span>
          <h2>Every screen is an opportunity.</h2>
          <a href="/login">
            Open your workspace <ArrowRight size={20} />
          </a>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="landing-brand" href="/">
          <Monitor size={22} /> OpenFrame
          <span className="landing-wordmark-dot">.</span>
        </a>
        <span>Open source. On your network. Under your control.</span>
        <div>
          <a href={repository}>
            GitHub <ArrowRight size={13} />
          </a>
          <a href={`${repository}/blob/main/LICENSE`}>MIT license</a>
          <a href="/login">Log in</a>
        </div>
      </footer>
    </div>
  );
}
