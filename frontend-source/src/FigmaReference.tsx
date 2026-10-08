import { useMemo, useRef, useState } from "react";

type DeviceType = "inverter" | "transformer" | "kiosk" | "meter";
type DeviceStatus = "online" | "warning" | "offline";

type Device = {
  id: number;
  type: DeviceType;
  name: string;
  code: string;
  x: number;
  y: number;
  status: DeviceStatus;
  power: boolean;
  output: string;
  voltage: string;
  temperature: string;
  group: string;
};

type Connection = {
  id: number;
  from: number;
  to: number;
};

const deviceMeta: Record<
  DeviceType,
  { label: string; short: string; color: string; icon: string }
> = {
  inverter: { label: "İnvertör", short: "INV", color: "amber", icon: "wave" },
  transformer: { label: "Trafo", short: "TR", color: "violet", icon: "bolt" },
  kiosk: { label: "Köşk", short: "KŞK", color: "blue", icon: "kiosk" },
  meter: { label: "Sayaç", short: "SM", color: "cyan", icon: "meter" },
};

const initialDevices: Device[] = [
  {
    id: 1,
    type: "kiosk",
    name: "Ana Dağıtım Köşkü",
    code: "KSK-01",
    x: 110,
    y: 205,
    status: "online",
    power: true,
    output: "4.82 MW",
    voltage: "34.5 kV",
    temperature: "31 °C",
    group: "Merkez",
  },
  {
    id: 2,
    type: "transformer",
    name: "Trafo A",
    code: "TR-01",
    x: 405,
    y: 120,
    status: "online",
    power: true,
    output: "2.41 MW",
    voltage: "800 V",
    temperature: "46 °C",
    group: "Blok A",
  },
  {
    id: 3,
    type: "transformer",
    name: "Trafo B",
    code: "TR-02",
    x: 405,
    y: 330,
    status: "warning",
    power: true,
    output: "2.36 MW",
    voltage: "798 V",
    temperature: "61 °C",
    group: "Blok B",
  },
  {
    id: 4,
    type: "inverter",
    name: "İnvertör 01",
    code: "INV-A01",
    x: 710,
    y: 55,
    status: "online",
    power: true,
    output: "804 kW",
    voltage: "781 V",
    temperature: "42 °C",
    group: "Blok A",
  },
  {
    id: 5,
    type: "inverter",
    name: "İnvertör 02",
    code: "INV-A02",
    x: 710,
    y: 195,
    status: "online",
    power: true,
    output: "796 kW",
    voltage: "779 V",
    temperature: "44 °C",
    group: "Blok A",
  },
  {
    id: 6,
    type: "inverter",
    name: "İnvertör 03",
    code: "INV-B01",
    x: 710,
    y: 335,
    status: "warning",
    power: true,
    output: "742 kW",
    voltage: "774 V",
    temperature: "57 °C",
    group: "Blok B",
  },
  {
    id: 7,
    type: "inverter",
    name: "İnvertör 04",
    code: "INV-B02",
    x: 710,
    y: 475,
    status: "offline",
    power: false,
    output: "0 kW",
    voltage: "0 V",
    temperature: "28 °C",
    group: "Blok B",
  },
];

const initialConnections: Connection[] = [
  { id: 1, from: 1, to: 2 },
  { id: 2, from: 1, to: 3 },
  { id: 3, from: 2, to: 4 },
  { id: 4, from: 2, to: 5 },
  { id: 5, from: 3, to: 6 },
  { id: 6, from: 3, to: 7 },
];

function Icon({
  name,
  size = 18,
}: {
  name: string;
  size?: number;
}) {
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    wave: <path d="M3 12h3l2-5 4 10 3-7 2 2h4" />,
    kiosk: (
      <>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M2 21h20M9 21v-7h6v7M8 9h8" />
      </>
    ),
    meter: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 12 4-3M7 16h10" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
      </>
    ),
    layers: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </>
    ),
    cursor: <path d="m4 3 7.5 17 2.1-6.4L20 11.5 4 3Z" />,
    hand: (
      <>
        <path d="M18 11V7a2 2 0 0 0-4 0v3M14 10V5a2 2 0 0 0-4 0v5M10 10V7a2 2 0 0 0-4 0v7" />
        <path d="m6 12-1.2-1.2a2 2 0 0 0-2.8 2.8l5 6A4 4 0 0 0 10 21h4a6 6 0 0 0 6-6v-4a2 2 0 0 0-4 0v1" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    power: (
      <>
        <path d="M12 2v10" />
        <path d="M6.3 5.7a8 8 0 1 0 11.4 0" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
        <path d="M1 14h6M9 8h6M17 16h6" />
      </>
    ),
    undo: <path d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6" />,
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function AppButton({
  children,
  className = "",
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const defaultForType = (type: DeviceType, id: number): Device => ({
  id,
  type,
  name: `Yeni ${deviceMeta[type].label}`,
  code: `${deviceMeta[type].short}-${String(id).padStart(2, "0")}`,
  x: 310 + (id % 4) * 45,
  y: 180 + (id % 3) * 55,
  status: "online",
  power: true,
  output: type === "inverter" ? "0 kW" : "0 MW",
  voltage: "0 V",
  temperature: "24 °C",
  group: "Atanmamış",
});

export default function App() {
  const [devices, setDevices] = useState(initialDevices);
  const [connections, setConnections] = useState(initialConnections);
  const [selectedId, setSelectedId] = useState<number | null>(4);
  const [zoom, setZoom] = useState(0.82);
  const [compact, setCompact] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(
    null,
  );

  const selected = devices.find((device) => device.id === selectedId) ?? null;
  const activePower = devices.filter((device) => device.power).length;
  const groups = useMemo(
    () => new Set(devices.map((device) => device.group)).size,
    [devices],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const updateDevice = (id: number, update: Partial<Device>) => {
    setDevices((items) =>
      items.map((device) => (device.id === id ? { ...device, ...update } : device)),
    );
  };

  const addDevice = (type: DeviceType) => {
    const id = Math.max(0, ...devices.map((device) => device.id)) + 1;
    setDevices((items) => [...items, defaultForType(type, id)]);
    setSelectedId(id);
    setAddOpen(false);
    notify(`${deviceMeta[type].label} tuvale eklendi`);
  };

  const removeSelected = () => {
    if (!selected) return;
    setDevices((items) => items.filter((device) => device.id !== selected.id));
    setConnections((items) =>
      items.filter(
        (connection) =>
          connection.from !== selected.id && connection.to !== selected.id,
      ),
    );
    setSelectedId(null);
    notify("Cihaz sahadan kaldırıldı");
  };

  const handleNodeClick = (id: number) => {
    if (connectingFrom !== null && connectingFrom !== id) {
      const exists = connections.some(
        (connection) =>
          (connection.from === connectingFrom && connection.to === id) ||
          (connection.from === id && connection.to === connectingFrom),
      );
      if (!exists) {
        setConnections((items) => [
          ...items,
          { id: Date.now(), from: connectingFrom, to: id },
        ]);
        notify("Cihaz bağlantısı oluşturuldu");
      }
      setConnectingFrom(null);
    }
    setSelectedId(id);
  };

  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    device: Device,
  ) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      id: device.id,
      offsetX: event.clientX / zoom - device.x,
      offsetY: event.clientY / zoom - device.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragNode = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / zoom - dragRef.current.offsetX;
    const y = (event.clientY - bounds.top) / zoom - dragRef.current.offsetY;
    updateDevice(dragRef.current.id, {
      x: Math.max(18, Math.min(850, x)),
      y: Math.max(20, Math.min(560, y)),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const connectionPath = (connection: Connection) => {
    const from = devices.find((device) => device.id === connection.from);
    const to = devices.find((device) => device.id === connection.to);
    if (!from || !to) return null;
    const nodeWidth = compact ? 122 : 174;
    const nodeHeight = compact ? 62 : 94;
    const x1 = from.x + nodeWidth;
    const y1 = from.y + nodeHeight / 2;
    const x2 = to.x;
    const y2 = to.y + nodeHeight / 2;
    const curve = Math.max(55, Math.abs(x2 - x1) * 0.46);
    const powered = from.power && to.power;
    return {
      d: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
      powered,
    };
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Icon name="bolt" size={19} />
          </div>
          <div>
            <strong>SolarGrid</strong>
            <span>ENERJİ YÖNETİMİ</span>
          </div>
        </div>
        <div className="site-switcher">
          <span className="site-icon">
            <Icon name="grid" size={15} />
          </span>
          <div>
            <small>AKTİF SAHA</small>
            <b>Konya GES · 12.4 MWp</b>
          </div>
          <span className="down-caret">⌄</span>
        </div>
        <nav className="top-actions" aria-label="Ana araçlar">
          <div className="sync-state">
            <i />
            CANLI
          </div>
          <AppButton className="icon-button" title="Bildirimler">
            <Icon name="bell" />
            <span className="notification-dot" />
          </AppButton>
          <div className="settings-wrap">
            <AppButton
              className={`top-settings ${settingsOpen ? "active" : ""}`}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Icon name="settings" />
              Sistem Ayarları
            </AppButton>
            {settingsOpen && (
              <div className="settings-menu">
                <div className="settings-menu-head">
                  <span>Sistem yapılandırması</span>
                  <small>Yönetici erişimi</small>
                </div>
                {[
                  ["sliders", "Genel saha ayarları", "Birimler, eşikler ve görünüm"],
                  ["link", "Modbus & bağlantılar", "TCP/IP, port ve cihaz adresleri"],
                  ["wave", "İnvertör ayarları", "Limitler ve çalışma modları"],
                  ["bolt", "Enerji yönetimi", "Şebeke ve güç kontrolü"],
                ].map(([icon, title, description]) => (
                  <AppButton
                    className="settings-item"
                    key={title}
                    onClick={() => notify(`${title} yakında yapılandırılabilir`)}
                  >
                    <span><Icon name={icon} /></span>
                    <div>
                      <b>{title}</b>
                      <small>{description}</small>
                    </div>
                    <Icon name="chevron" size={14} />
                  </AppButton>
                ))}
                <div className="role-note">
                  <Icon name="eye" size={16} />
                  Gelecek roller için hazır: Yönetici · Operatör · Okuyucu
                </div>
              </div>
            )}
          </div>
          <div className="avatar">MA</div>
        </nav>
      </header>

      <section className="workspace">
        <aside className="tool-sidebar">
          <div className="tool-section">
            <span className="section-label">SAHA ARAÇLARI</span>
            <AppButton className="side-tool active">
              <Icon name="cursor" />
              <span>Seç & taşı</span>
              <kbd>V</kbd>
            </AppButton>
            <AppButton
              className={`side-tool ${connectingFrom !== null ? "active" : ""}`}
              onClick={() => {
                setConnectingFrom(selectedId);
                if (!selectedId) notify("Önce bir cihaz seçin");
              }}
            >
              <Icon name="link" />
              <span>Bağlantı çiz</span>
              <kbd>C</kbd>
            </AppButton>
            <AppButton className="side-tool" onClick={() => notify("Tuvali sürükleyebilirsiniz")}>
              <Icon name="hand" />
              <span>Tuvali kaydır</span>
              <kbd>H</kbd>
            </AppButton>
          </div>
          <div className="tool-section">
            <span className="section-label">EKLE</span>
            {(Object.keys(deviceMeta) as DeviceType[]).map((type) => (
              <AppButton
                className="device-tool"
                key={type}
                onClick={() => addDevice(type)}
              >
                <span className={`device-tool-icon ${deviceMeta[type].color}`}>
                  <Icon name={deviceMeta[type].icon} />
                </span>
                <span>
                  <b>{deviceMeta[type].label}</b>
                  <small>Tuvale ekle</small>
                </span>
                <Icon name="plus" size={15} />
              </AppButton>
            ))}
          </div>
          <div className="tool-section">
            <span className="section-label">DÜZEN</span>
            <AppButton
              className={`side-tool ${compact ? "active" : ""}`}
              onClick={() => setCompact((value) => !value)}
            >
              <Icon name="layers" />
              <span>Kompakt görünüm</span>
              <span className={`mini-toggle ${compact ? "on" : ""}`} />
            </AppButton>
          </div>
          <div className="sidebar-summary">
            <div>
              <span>{devices.length}</span>
              <small>Cihaz</small>
            </div>
            <div>
              <span>{groups}</span>
              <small>Grup</small>
            </div>
            <div>
              <span>{activePower}</span>
              <small>Aktif</small>
            </div>
          </div>
        </aside>

        <div className="canvas-column">
          <div className="canvas-toolbar">
            <div>
              <b>Saha Tek Hat Şeması</b>
              <span>Son kayıt: şimdi</span>
            </div>
            <div className="canvas-actions">
              {connectingFrom !== null && (
                <div className="connect-notice">
                  <i />
                  Hedef cihazı seçin
                  <AppButton onClick={() => setConnectingFrom(null)}>
                    <Icon name="x" size={14} />
                  </AppButton>
                </div>
              )}
              <AppButton className="soft-button" onClick={() => notify("Değişiklikler kaydedildi")}>
                <Icon name="undo" size={16} />
                Geri al
              </AppButton>
              <AppButton className="primary-button" onClick={() => setAddOpen((open) => !open)}>
                <Icon name="plus" size={17} />
                Cihaz ekle
              </AppButton>
              {addOpen && (
                <div className="quick-add">
                  {(Object.keys(deviceMeta) as DeviceType[]).map((type) => (
                    <AppButton key={type} onClick={() => addDevice(type)}>
                      <span className={`device-tool-icon ${deviceMeta[type].color}`}>
                        <Icon name={deviceMeta[type].icon} size={17} />
                      </span>
                      {deviceMeta[type].label}
                    </AppButton>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            className="canvas-viewport"
            ref={canvasRef}
            onPointerMove={dragNode}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={() => setAddOpen(false)}
          >
            <div className="canvas-status">
              <span><i className="flowing" /> Enerji akışı aktif</span>
              <span><i className="stopped" /> Enerji kesik</span>
            </div>
            <div
              className="canvas-world"
              style={{ transform: `scale(${zoom})` }}
            >
              <svg className="connections" viewBox="0 0 1050 680">
                <defs>
                  <marker
                    id="arrow-active"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" className="arrow-active" />
                  </marker>
                  <marker
                    id="arrow-off"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" className="arrow-off" />
                  </marker>
                </defs>
                {connections.map((connection) => {
                  const path = connectionPath(connection);
                  if (!path) return null;
                  return (
                    <g key={connection.id}>
                      <path d={path.d} className="connection-halo" />
                      <path
                        d={path.d}
                        className={path.powered ? "connection active" : "connection off"}
                        markerEnd={`url(#arrow-${path.powered ? "active" : "off"})`}
                      />
                      {path.powered && (
                        <path d={path.d} className="energy-pulse" />
                      )}
                    </g>
                  );
                })}
              </svg>

              {devices.map((device) => {
                const meta = deviceMeta[device.type];
                return (
                  <div
                    key={device.id}
                    className={[
                      "device-node",
                      compact ? "compact" : "",
                      selectedId === device.id ? "selected" : "",
                      connectingFrom === device.id ? "connecting" : "",
                      !device.power ? "powered-off" : "",
                    ].join(" ")}
                    style={{ left: device.x, top: device.y }}
                    onPointerDown={(event) => startDrag(event, device)}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleNodeClick(device.id);
                    }}
                  >
                    <div className="node-controls">
                      <span className={`node-status ${device.status}`}>
                        <i />
                        {device.status === "online"
                          ? "Çalışıyor"
                          : device.status === "warning"
                            ? "Uyarı"
                            : "Devre dışı"}
                      </span>
                      <AppButton
                        className={`power-button ${device.power ? "on" : "off"}`}
                        title={device.power ? "Enerjiyi kes" : "Enerjiyi ver"}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateDevice(device.id, {
                            power: !device.power,
                            status: device.power ? "offline" : "online",
                            output: device.power ? "0 kW" : device.output,
                          });
                          notify(device.power ? "Enerji kesildi" : "Enerji yeniden verildi");
                        }}
                      >
                        <Icon name="power" size={14} />
                      </AppButton>
                    </div>
                    <div className="node-main">
                      <span className={`node-icon ${meta.color}`}>
                        <Icon name={meta.icon} size={compact ? 17 : 21} />
                      </span>
                      <div className="node-title">
                        <b>{device.name}</b>
                        <span>{device.code}</span>
                      </div>
                    </div>
                    {!compact && (
                      <div className="node-reading">
                        <span>Anlık üretim</span>
                        <b>{device.output}</b>
                      </div>
                    )}
                    <span className="port input-port" />
                    <span className="port output-port" />
                  </div>
                );
              })}
            </div>
            <div className="zoom-controls">
              <AppButton onClick={() => setZoom((value) => Math.min(1.15, value + 0.08))}>
                <Icon name="plus" size={16} />
              </AppButton>
              <span>{Math.round(zoom * 100)}%</span>
              <AppButton onClick={() => setZoom((value) => Math.max(0.55, value - 0.08))}>
                <span className="minus">−</span>
              </AppButton>
            </div>
            <div className="minimap">
              <div className="minimap-map">
                {devices.map((device) => (
                  <i
                    key={device.id}
                    className={device.power ? "active" : ""}
                    style={{ left: device.x / 9.5, top: device.y / 8 }}
                  />
                ))}
                <span />
              </div>
              <small>MİNİ HARİTA</small>
            </div>
          </div>
        </div>

        <aside className={`inspector ${selected ? "open" : ""}`}>
          {selected ? (
            <>
              <div className="inspector-head">
                <div>
                  <span className={`node-icon ${deviceMeta[selected.type].color}`}>
                    <Icon name={deviceMeta[selected.type].icon} />
                  </span>
                  <div>
                    <small>{deviceMeta[selected.type].label.toUpperCase()}</small>
                    <b>{selected.name}</b>
                  </div>
                </div>
                <AppButton className="icon-button" onClick={() => setSelectedId(null)}>
                  <Icon name="x" size={17} />
                </AppButton>
              </div>

              <div className={`power-banner ${selected.power ? "active" : "off"}`}>
                <div>
                  <i />
                  <span>
                    <small>ENERJİ DURUMU</small>
                    <b>{selected.power ? "Devrede" : "Enerji kesik"}</b>
                  </span>
                </div>
                <AppButton
                  onClick={() => {
                    updateDevice(selected.id, {
                      power: !selected.power,
                      status: selected.power ? "offline" : "online",
                    });
                    notify(selected.power ? "Enerji kesildi" : "Enerji yeniden verildi");
                  }}
                >
                  <Icon name="power" size={15} />
                  {selected.power ? "Kes" : "Devreye al"}
                </AppButton>
              </div>

              <div className="inspector-section">
                <div className="section-title">
                  <span>CANLI DEĞERLER</span>
                  <small>2 sn önce</small>
                </div>
                <div className="metric-grid">
                  <div>
                    <span>Aktif güç</span>
                    <b>{selected.output}</b>
                    <small>↑ %2.4</small>
                  </div>
                  <div>
                    <span>Gerilim</span>
                    <b>{selected.voltage}</b>
                    <small>Nominal</small>
                  </div>
                  <div>
                    <span>Sıcaklık</span>
                    <b>{selected.temperature}</b>
                    <small className={selected.status === "warning" ? "warn" : ""}>
                      {selected.status === "warning" ? "Yüksek" : "Normal"}
                    </small>
                  </div>
                  <div>
                    <span>Verim</span>
                    <b>{selected.power ? "% 98.2" : "% 0"}</b>
                    <small>Günlük</small>
                  </div>
                </div>
              </div>

              <div className="inspector-section">
                <div className="section-title">
                  <span>CİHAZ BİLGİLERİ</span>
                </div>
                <label className="field">
                  <span>Cihaz adı</span>
                  <input
                    value={selected.name}
                    onChange={(event) =>
                      updateDevice(selected.id, { name: event.target.value })
                    }
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Cihaz kodu</span>
                    <input
                      value={selected.code}
                      onChange={(event) =>
                        updateDevice(selected.id, { code: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Grup</span>
                    <select
                      value={selected.group}
                      onChange={(event) =>
                        updateDevice(selected.id, { group: event.target.value })
                      }
                    >
                      <option>Merkez</option>
                      <option>Blok A</option>
                      <option>Blok B</option>
                      <option>Atanmamış</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="inspector-section">
                <div className="section-title">
                  <span>BAĞLANTI</span>
                </div>
                <div className="connection-info">
                  <i />
                  <div>
                    <b>Modbus TCP bağlı</b>
                    <span>192.168.1.{20 + selected.id}:502</span>
                  </div>
                  <span>12 ms</span>
                </div>
              </div>

              <div className="inspector-footer">
                <AppButton
                  className="outline-button"
                  onClick={() => {
                    setConnectingFrom(selected.id);
                    notify("Bağlanacak hedef cihazı seçin");
                  }}
                >
                  <Icon name="link" size={16} />
                  Bağlantı ekle
                </AppButton>
                <AppButton className="danger-button" onClick={removeSelected}>
                  <Icon name="trash" size={16} />
                </AppButton>
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              <Icon name="cursor" size={28} />
              <b>Bir cihaz seçin</b>
              <span>Detayları görmek ve düzenlemek için tuvaldeki bir cihaza tıklayın.</span>
            </div>
          )}
        </aside>
      </section>
      {toast && <div className="toast"><i />{toast}</div>}
    </main>
  );
}
