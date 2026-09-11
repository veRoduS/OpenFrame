import { useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, Trash2, Upload, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { api } from './types';

type Vpn = {
  id: string;
  name: string;
  server: string;
  addresses: string;
  endpoints: string;
  fullTunnel: boolean;
  assignedTo: string | null;
  createdAt: string;
};
type Setup = {
  id: string;
  name: string;
  server: string;
  vpnId: string | null;
  createdAt: string;
};
type Inventory = { vpns: Vpn[]; setups: Setup[]; defaultServer: string };

export function ScreenSetup({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('build');
  const [inventory, setInventory] = useState<Inventory>({
    vpns: [],
    setups: [],
    defaultServer: '',
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [vpnId, setVpnId] = useState('');
  const [transport, setTransport] = useState('direct');
  const [wifi, setWifi] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('US');
  const [access, setAccess] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [vpnName, setVpnName] = useState('');
  const [vpnServer, setVpnServer] = useState('');
  const [config, setConfig] = useState('');
  const [fileName, setFileName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedVpn = inventory.vpns.find((v) => v.id === vpnId);
  const refresh = async () =>
    setInventory(await api<Inventory>('/api/screen-setup'));
  useEffect(() => {
    let active = true;
    api<Inventory>('/api/screen-setup')
      .then((data) => {
        if (!active) return;
        setInventory(data);
        const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(
          window.location.hostname,
        );
        setServer(
          data.defaultServer || (localOnly ? '' : window.location.origin),
        );
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  function run(action: () => Promise<void>) {
    if (busy) return;
    setError('');
    setBusy(true);
    void action()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }
  async function download(id: string) {
    const response = await fetch(`/api/screen-setup/setups/${id}/download`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(
        data.error || 'Download failed. Retry from Issued setups.',
      );
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `openframe-screen-${id}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function create() {
    const setup = await api<Setup>('/api/screen-setup/setups', 'POST', {
      name,
      ...(transport === 'wireguard' ? { vpnId } : { server }),
      ...(wifi ? { wifi: { ssid, password, country } } : {}),
      ...(access
        ? { access: { client_id: clientId, client_secret: clientSecret } }
        : {}),
    });
    setPassword('');
    setWifi(false);
    setSsid('');
    setClientSecret('');
    setClientId('');
    setAccess(false);
    setName('');
    setVpnId('');
    setTab('issued');
    await refresh();
    await download(setup.id);
  }
  async function importConfig() {
    await api('/api/screen-setup/vpns', 'POST', {
      name: vpnName,
      server: vpnServer,
      config,
    });
    setConfig('');
    setFileName('');
    setVpnName('');
    if (fileInput.current) fileInput.current.value = '';
    await refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="of-modal wide screen-setup">
        <DialogTitle>Screen setup</DialogTitle>
        <DialogDescription className="sr-only">
          Screen configurations and WireGuard inventory
        </DialogDescription>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setError('');
          }}
        >
          <TabsList className="setup-tabs">
            <TabsTrigger value="build">Build config</TabsTrigger>
            <TabsTrigger value="vpns">VPN configs</TabsTrigger>
            <TabsTrigger value="issued">Issued setups</TabsTrigger>
          </TabsList>
        </Tabs>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {loading ? (
          <output>Loading configurations...</output>
        ) : (
          <fieldset disabled={busy} className="setup-content">
            {tab === 'build' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(create);
                }}
              >
                <div className="setup-grid">
                  <label>
                    Screen name
                    <input
                      required
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Connection
                    <select
                      value={transport}
                      onChange={(e) => {
                        setTransport(e.target.value);
                        setVpnId('');
                      }}
                    >
                      <option value="direct">LAN / HTTPS</option>
                      <option value="wireguard">WireGuard</option>
                    </select>
                  </label>
                </div>
                {transport === 'wireguard' ? (
                  <>
                    <label>
                      Available VPN config
                      <select
                        required
                        value={vpnId}
                        onChange={(e) => setVpnId(e.target.value)}
                      >
                        <option value="">Select a client config</option>
                        {inventory.vpns
                          .filter((v) => !v.assignedTo)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} ({v.addresses})
                            </option>
                          ))}
                      </select>
                    </label>
                    {!inventory.vpns.some((v) => !v.assignedTo) && (
                      <p className="setup-empty">No available VPN configs</p>
                    )}
                    {selectedVpn && (
                      <div className="setup-summary">
                        <span>{selectedVpn.server}</span>
                        <span>{selectedVpn.endpoints}</span>
                      </div>
                    )}
                    {selectedVpn?.fullTunnel && (
                      <p role="note" className="setup-warning">
                        Full-tunnel VPN: all network traffic may be redirected,
                        including SSH.
                      </p>
                    )}
                  </>
                ) : (
                  <label>
                    Home server URL
                    <input
                      type="url"
                      required
                      value={server}
                      onChange={(e) => setServer(e.target.value)}
                      placeholder="https://openframe.example.com"
                    />
                  </label>
                )}
                <div className="setup-option">
                  <label htmlFor="setup-wifi">Wi-Fi</label>
                  <Switch
                    id="setup-wifi"
                    checked={wifi}
                    onCheckedChange={setWifi}
                  />
                </div>
                {wifi && (
                  <div className="setup-grid">
                    <label>
                      Network name (SSID)
                      <input
                        required
                        maxLength={32}
                        value={ssid}
                        onChange={(e) => setSsid(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Wi-Fi password
                      <input
                        type="password"
                        maxLength={64}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label>
                      Country code
                      <input
                        required
                        pattern="[A-Z]{2}"
                        maxLength={2}
                        value={country}
                        onChange={(e) =>
                          setCountry(e.target.value.toUpperCase())
                        }
                      />
                    </label>
                  </div>
                )}
                <div className="setup-option">
                  <label htmlFor="setup-access">
                    Cloudflare Access service token
                  </label>
                  <Switch
                    id="setup-access"
                    checked={access}
                    onCheckedChange={setAccess}
                  />
                </div>
                {access && (
                  <div className="setup-grid">
                    <label>
                      Client ID
                      <input
                        required
                        maxLength={2048}
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Client secret
                      <input
                        type="password"
                        required
                        maxLength={2048}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                )}
                <p className="setup-warning" role="note">
                  <ShieldCheck size={18} />
                  Downloaded files contain plaintext credentials. Keep this
                  bundle private and use it for one screen only.
                </p>
                <div className="dialog-actions">
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || (transport === 'wireguard' && !vpnId)}
                  >
                    <Download size={18} />
                    {busy ? 'Preparing...' : 'Create and download'}
                  </button>
                </div>
              </form>
            )}
            {tab === 'vpns' && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(importConfig);
                  }}
                >
                  <div className="setup-grid">
                    <label>
                      VPN config name
                      <input
                        required
                        maxLength={100}
                        value={vpnName}
                        onChange={(e) => setVpnName(e.target.value)}
                      />
                    </label>
                    <label>
                      VPN-reachable server URL
                      <input
                        type="url"
                        required
                        value={vpnServer}
                        onChange={(e) => setVpnServer(e.target.value)}
                        placeholder="http://10.8.0.1:3100"
                      />
                    </label>
                  </div>
                  <label>
                    WireGuard client file
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".conf,text/plain"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setConfig('');
                        setFileName('');
                        if (!file) return;
                        run(async () => {
                          if (file.size > 65536)
                            throw new Error('WireGuard config exceeds 64 KiB');
                          const text = new TextDecoder('utf-8', {
                            fatal: true,
                          }).decode(await file.arrayBuffer());
                          setConfig(text);
                          setFileName(file.name);
                        });
                      }}
                    />
                  </label>
                  <div className="dialog-actions">
                    <button
                      type="submit"
                      className="primary"
                      disabled={busy || !config}
                    >
                      <Upload size={18} />
                      Import client config
                    </button>
                  </div>
                  {fileName && (
                    <span className="sr-only">Selected {fileName}</span>
                  )}
                </form>
                <div className="setup-list" aria-label="VPN inventory">
                  {inventory.vpns.length === 0 && (
                    <p className="setup-empty">No saved VPN configs</p>
                  )}
                  {inventory.vpns.map((v) => (
                    <div className="setup-row" key={v.id}>
                      <div>
                        <strong>{v.name}</strong>
                        <small>
                          {v.addresses} · {v.server}
                        </small>
                        <small>{v.endpoints}</small>
                      </div>
                      <span
                        className={`setup-state ${v.assignedTo ? 'allocated' : ''}`}
                      >
                        {v.assignedTo
                          ? `Allocated: ${inventory.setups.find((s) => s.id === v.assignedTo)?.name || 'screen'}`
                          : 'Available'}
                      </span>
                      {!v.assignedTo &&
                        (deleteId === v.id ? (
                          <div className="setup-delete">
                            <button onClick={() => setDeleteId(null)}>
                              Cancel
                            </button>
                            <button
                              onClick={() =>
                                run(async () => {
                                  await api(
                                    `/api/screen-setup/vpns/${v.id}`,
                                    'DELETE',
                                  );
                                  setDeleteId(null);
                                  await refresh();
                                })
                              }
                            >
                              Delete unused config
                            </button>
                          </div>
                        ) : (
                          <button
                            className="icon-button"
                            title={`Delete ${v.name}`}
                            aria-label={`Delete ${v.name}`}
                            onClick={() => setDeleteId(v.id)}
                          >
                            <Trash2 size={17} />
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === 'issued' && (
              <div className="setup-list" aria-label="Issued screen setups">
                {!inventory.setups.length && (
                  <p className="setup-empty">No issued setups</p>
                )}
                {inventory.setups.map((s) => (
                  <div className="setup-row" key={s.id}>
                    <div>
                      <strong>{s.name}</strong>
                      <small>{s.server}</small>
                      <small>{new Date(s.createdAt).toLocaleString()}</small>
                    </div>
                    <span className="setup-state allocated">
                      {s.vpnId ? 'WireGuard' : 'LAN / HTTPS'}
                    </span>
                    <button
                      className="icon-button"
                      title={`Download ${s.name}`}
                      aria-label={`Download ${s.name}`}
                      onClick={() => run(() => download(s.id))}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                ))}
                <div className="dialog-actions">
                  <button onClick={() => setTab('build')}>
                    <FilePlus2 size={18} />
                    New setup
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        )}
      </DialogContent>
    </Dialog>
  );
}
