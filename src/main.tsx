import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  Copy,
  CreditCard,
  Crown,
  Download,
  FileText,
  Lock,
  Mail,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  X as XIcon,
} from "lucide-react";
import "./styles.css";

type Title = "" | "ポケカ" | "ワンピ" | "DBFW";
type Condition = "美品A" | "微傷B" | "傷ありC";
type Rarity = "" | "SAR" | "SR" | "UR" | "SEC" | "L" | "AR" | "R" | "その他";
type PsaRank = "PSA10" | "PSA9" | "PSA8" | "PSA7" | "PSA6以下" | "鑑定中";
type Sheet = "inventory" | "sold";
type BillingPlan = "free" | "pro";
type BillingFeature = "ads" | "search" | "period" | "importExport";

type InventoryRow = {
  id: string;
  selected: boolean;
  title: Title;
  modelNumber: string;
  cardName: string;
  note: string;
  rarity: Rarity;
  quantity: number | null;
  purchasePrice: number;
  targetPrice: number;
  feeRatePercent: number | null;
  shippingFee: number | null;
  purchaseDate: string;
  saleDate: string;
  condition: Condition;
  psaChecked: boolean;
  psaRank: PsaRank;
};

type AppSettings = {
  feeRate: number;
  shipping: number;
};

type ImportPayload = {
  version?: number;
  exportedAt?: string;
  settings?: Partial<AppSettings>;
  rows?: unknown[];
};

type BillingState = {
  plan: BillingPlan;
  activatedAt?: string;
};

const STORAGE_KEY = "trading-card-speed-inventory:v2";
const LEGACY_STORAGE_KEY = "trading-card-speed-inventory:v1";
const SETTINGS_KEY = "trading-card-speed-inventory:settings:v1";
const BILLING_KEY = "trading-card-speed-inventory:billing:v1";
const PRO_PRICE_LABEL = "月額480円";
const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK ?? "";

const titles: Title[] = ["", "ポケカ", "ワンピ", "DBFW"];
const rarities: Rarity[] = ["", "SAR", "SR", "UR", "SEC", "L", "AR", "R", "その他"];
const conditions: Condition[] = ["美品A", "微傷B", "傷ありC"];
const psaRanks: PsaRank[] = ["PSA10", "PSA9", "PSA8", "PSA7", "PSA6以下", "鑑定中"];

const yen = new Intl.NumberFormat("ja-JP");

const featureLabels: Record<BillingFeature, string> = {
  ads: "広告非表示",
  search: "メルカリ・X検索",
  period: "期間集計",
  importExport: "インポート / エクスポート",
};

const emptyRow = (): InventoryRow => ({
  id: crypto.randomUUID(),
  selected: false,
  title: "",
  modelNumber: "",
  cardName: "",
  note: "",
  rarity: "",
  quantity: null,
  purchasePrice: 0,
  targetPrice: 0,
  feeRatePercent: null,
  shippingFee: null,
  purchaseDate: "",
  saleDate: "",
  condition: "美品A",
  psaChecked: false,
  psaRank: "PSA10",
});

const emptyRows = (count = 10): InventoryRow[] => Array.from({ length: count }, () => emptyRow());

function isBlankRow(row: InventoryRow): boolean {
  return (
    !row.modelNumber.trim() &&
    !row.cardName.trim() &&
    !row.note.trim() &&
    row.quantity === null &&
    row.purchasePrice === 0 &&
    row.targetPrice === 0 &&
    row.feeRatePercent === null &&
    row.shippingFee === null &&
    !row.purchaseDate &&
    !row.saleDate &&
    !row.psaChecked
  );
}

function toNumber(value: string): number {
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function pickValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeDate(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRow(value: unknown): InventoryRow {
  const source = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const row = emptyRow();
  return {
    ...row,
    id: typeof source.id === "string" ? source.id : row.id,
    selected: typeof source.selected === "boolean" ? source.selected : false,
    title: pickValue(source.title, titles, ""),
    modelNumber:
      typeof source.modelNumber === "string"
        ? source.modelNumber
        : typeof source.cardText === "string"
          ? source.cardText
          : "",
    cardName: typeof source.cardName === "string" ? source.cardName : "",
    note: typeof source.note === "string" ? source.note : "",
    rarity: pickValue(source.rarity, rarities, ""),
    quantity:
      source.quantity === null || source.quantity === undefined || source.quantity === ""
        ? null
        : Math.max(0, Math.round(Number(source.quantity) || 0)),
    purchasePrice: Math.max(0, Math.round(Number(source.purchasePrice) || 0)),
    targetPrice: Math.max(0, Math.round(Number(source.targetPrice) || 0)),
    feeRatePercent: nullableNumber(source.feeRatePercent),
    shippingFee: nullableNumber(source.shippingFee),
    purchaseDate: normalizeDate(source.purchaseDate),
    saleDate: normalizeDate(source.saleDate),
    condition: pickValue(source.condition, conditions, "美品A"),
    psaChecked: Boolean(source.psaChecked),
    psaRank: pickValue(source.psaRank, psaRanks, "PSA10"),
  };
}

function calcNetProfit(row: InventoryRow, settings: AppSettings): number {
  if (!row.targetPrice) return -row.purchasePrice;
  const feeRate = row.feeRatePercent === null ? settings.feeRate : row.feeRatePercent / 100;
  const shipping = row.shippingFee === null ? settings.shipping : row.shippingFee;
  return Math.round(
    row.targetPrice - row.targetPrice * feeRate - shipping - row.purchasePrice,
  );
}

function nextCondition(current: Condition): Condition {
  const index = conditions.indexOf(current);
  return conditions[(index + 1) % conditions.length];
}

function conditionClass(condition: Condition): string {
  if (condition === "美品A") return "condition-a";
  if (condition === "微傷B") return "condition-b";
  return "condition-c";
}

function searchText(row: InventoryRow): string {
  return [row.modelNumber, row.cardName].map((part) => part.trim()).filter(Boolean).join(" ");
}

function openMercari(row: InventoryRow) {
  const query = searchText(row);
  if (!query) return;
  const url = `https://jp.mercari.com/search?keyword=${encodeURIComponent(
    query,
  )}&status=on_sale,sold_out`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openX(row: InventoryRow) {
  const query = `${searchText(row)} 買取`.trim();
  if (!searchText(row)) return;
  const url = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function loadRows(): InventoryRow[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return emptyRows();
    const parsed = JSON.parse(saved) as unknown;
    const rawRows = Array.isArray(parsed) ? parsed : (parsed as ImportPayload).rows;
    const rows = Array.isArray(rawRows) ? rawRows.map(normalizeRow) : [];
    if (!rows.length) return emptyRows();
    if (rows.length === 1 && isBlankRow(rows[0])) return [rows[0], ...emptyRows(9)];
    return rows;
  } catch {
    return emptyRows();
  }
}

function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return { feeRate: 0.1, shipping: 210 };
    const parsed = JSON.parse(saved) as Partial<AppSettings>;
    return {
      feeRate: Number.isFinite(parsed.feeRate) ? Number(parsed.feeRate) : 0.1,
      shipping: Number.isFinite(parsed.shipping) ? Number(parsed.shipping) : 210,
    };
  } catch {
    return { feeRate: 0.1, shipping: 210 };
  }
}

function loadBilling(): BillingState {
  try {
    const saved = localStorage.getItem(BILLING_KEY);
    if (!saved) return { plan: "free" };
    const parsed = JSON.parse(saved) as Partial<BillingState>;
    return parsed.plan === "pro"
      ? { plan: "pro", activatedAt: typeof parsed.activatedAt === "string" ? parsed.activatedAt : undefined }
      : { plan: "free" };
  } catch {
    return { plan: "free" };
  }
}

function inPeriod(date: string, start: string, end: string): boolean {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function MarketingNav() {
  return (
    <header className="marketing-nav">
      <a className="marketing-brand" href="/">
        爆速トレカ在庫管理
      </a>
      <nav>
        <a href="/app">アプリ</a>
        <a href="/pricing">料金</a>
        <a href="/privacy">プライバシー</a>
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <a href="/terms">利用規約</a>
      <a href="/privacy">プライバシーポリシー</a>
      <a href="/contact">お問い合わせ</a>
      <span>© 2026 爆速トレカ在庫管理</span>
    </footer>
  );
}

function HomePage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="hero-panel">
        <div className="hero-copy">
          <p>ポケカ・ワンピ・DBFW向け</p>
          <h1>爆速トレカ在庫管理シート</h1>
          <span>
            画像を使わないExcel風UIで、スマホから仕入れ・売却目安・利益・売却済履歴をすばやく管理できます。
          </span>
          <div className="hero-actions">
            <a className="hero-primary" href="/app">
              アプリを開く
              <ArrowRight size={17} />
            </a>
            <a className="hero-secondary" href="/pricing">
              Proを見る
            </a>
          </div>
        </div>
        <div className="hero-product" aria-label="アプリ画面イメージ">
          <div className="mini-toolbar">
            <span>在庫</span>
            <span>売却済</span>
          </div>
          <div className="mini-sheet">
            <div>タイトル</div>
            <div>型番</div>
            <div>カード名</div>
            <div>利益</div>
            <div>ポケカ</div>
            <div>SV4a</div>
            <div>リザードン</div>
            <div className="profit">+590</div>
            <div>ワンピ</div>
            <div>OP01</div>
            <div>ルフィ</div>
            <div className="loss">-210</div>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <h2>使い方</h2>
        <div className="step-grid">
          <article>
            <Smartphone size={22} />
            <h3>1. 在庫を入力</h3>
            <p>型番、カード名、仕入れ値、売却価格、状態、PSA情報を表に直接入力します。</p>
          </article>
          <article>
            <Calculator size={22} />
            <h3>2. 利益を確認</h3>
            <p>手数料と送料を反映した手残り利益を自動計算します。行ごとの個別設定にも対応しています。</p>
          </article>
          <article>
            <Search size={22} />
            <h3>3. 相場を確認</h3>
            <p>型番・カード名からメルカリやX検索へすぐ移動できます。</p>
          </article>
          <article>
            <FileText size={22} />
            <h3>4. 売却済を管理</h3>
            <p>売却日を入れると売却済シートへ移動し、期間集計と実利益を確認できます。</p>
          </article>
        </div>
      </section>

      <section className="marketing-section compact-text">
        <h2>このサイトについて</h2>
        <p>
          個人バイヤー・コレクター向けの軽量な在庫管理ツールです。現在のデータ保存はブラウザ内のLocalStorageを利用しています。
          重要なデータはエクスポートでバックアップしてください。
        </p>
      </section>
      <MarketingFooter />
    </main>
  );
}

function PricingPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="content-page">
        <h1>料金</h1>
        <div className="pricing-grid">
          <article>
            <p className="plan-kicker">Free</p>
            <h2>無料</h2>
            <p>まずは在庫入力と利益計算を試せます。</p>
            <ul>
              <li>在庫入力</li>
              <li>手残り利益計算</li>
              <li>SNS用テキスト生成</li>
              <li>広告表示</li>
            </ul>
            <a href="/app">無料で使う</a>
          </article>
          <article className="featured-plan">
            <p className="plan-kicker">Pro</p>
            <h2>{PRO_PRICE_LABEL}</h2>
            <p>運用・分析・バックアップ向けの追加機能を使える月額プランです。</p>
            <ul>
              <li>広告非表示</li>
              <li>インポート / エクスポート</li>
              <li>検索・期間集計を制限なしで利用</li>
            </ul>
            <a href="/app">Proを見る</a>
          </article>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}

function PrivacyPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="content-page legal-page">
        <h1>プライバシーポリシー</h1>
        <p>本サービスは、トレーディングカードの在庫管理を支援するWebアプリです。</p>
        <h2>保存される情報</h2>
        <p>在庫データは利用者のブラウザ内のLocalStorageに保存されます。現時点ではサーバーに在庫データを送信しません。</p>
        <h2>広告について</h2>
        <p>本サービスでは広告配信サービスを利用する場合があります。広告配信のためCookie等が利用される場合があります。</p>
        <h2>お問い合わせ</h2>
        <p>お問い合わせはお問い合わせページからご連絡ください。</p>
      </section>
      <MarketingFooter />
    </main>
  );
}

function TermsPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="content-page legal-page">
        <h1>利用規約</h1>
        <h2>利用目的</h2>
        <p>本サービスは、トレーディングカードの在庫・売却管理を補助するためのツールです。</p>
        <h2>免責事項</h2>
        <p>計算結果や外部検索結果の正確性を保証するものではありません。取引判断は利用者自身の責任で行ってください。</p>
        <h2>禁止事項</h2>
        <p>不正アクセス、サービスの妨害、法令に違反する利用を禁止します。</p>
      </section>
      <MarketingFooter />
    </main>
  );
}

function ContactPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="content-page contact-page">
        <Mail size={28} />
        <h1>お問い合わせ</h1>
        <p>不具合報告、機能要望、広告掲載に関するご相談はこちらからご連絡ください。</p>
        <a href="mailto:contact@example.com">contact@example.com</a>
      </section>
      <MarketingFooter />
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="content-page contact-page">
        <ShieldCheck size={28} />
        <h1>ページが見つかりません</h1>
        <p>URLをご確認ください。</p>
        <a href="/">TOPへ戻る</a>
      </section>
      <MarketingFooter />
    </main>
  );
}

function InventoryApp() {
  const [rows, setRows] = useState<InventoryRow[]>(loadRows);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [billing, setBilling] = useState<BillingState>(loadBilling);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<BillingFeature | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "missing">("idle");
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState<Sheet>("inventory");
  const [salePeriodStart, setSalePeriodStart] = useState("");
  const [salePeriodEnd, setSalePeriodEnd] = useState("");
  const [purchasePeriodStart, setPurchasePeriodStart] = useState("");
  const [purchasePeriodEnd, setPurchasePeriodEnd] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "empty">("idle");
  const [importStatus, setImportStatus] = useState<"idle" | "done" | "error">("idle");
  const pendingFocusId = useRef<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const topScrollerRef = useRef<HTMLDivElement | null>(null);
  const tableScrollerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const isPro = billing.plan === "pro";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(BILLING_KEY, JSON.stringify(billing));
  }, [billing]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get("billing");
    if (billingResult !== "success" && billingResult !== "free") return;
    setBilling(
      billingResult === "success"
        ? { plan: "pro", activatedAt: new Date().toISOString() }
        : { plan: "free" },
    );
    setUpgradeOpen(false);
    params.delete("billing");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
  }, []);

  useEffect(() => {
    if (!pendingFocusId.current) return;
    inputRefs.current[pendingFocusId.current]?.focus();
    pendingFocusId.current = null;
  }, [rows]);

  const syncHorizontalScroll = (source: "top" | "table") => {
    const top = topScrollerRef.current;
    const table = tableScrollerRef.current;
    if (!top || !table) return;
    if (source === "top") table.scrollLeft = top.scrollLeft;
    else top.scrollLeft = table.scrollLeft;
  };

  const openUpgrade = (feature: BillingFeature | null = null) => {
    setUpgradeReason(feature);
    setCheckoutStatus("idle");
    setUpgradeOpen(true);
  };

  const requirePro = (feature: BillingFeature) => {
    openUpgrade(feature);
  };

  const startCheckout = () => {
    if (isPro) return;
    if (!STRIPE_PAYMENT_LINK) {
      setCheckoutStatus("missing");
      return;
    }
    window.location.href = STRIPE_PAYMENT_LINK;
  };

  const inventoryRows = useMemo(() => rows.filter((row) => !row.saleDate), [rows]);
  const soldRows = useMemo(() => rows.filter((row) => Boolean(row.saleDate)), [rows]);
  const baseRows = activeSheet === "inventory" ? inventoryRows : soldRows;
  const hasPurchaseFilter = Boolean(purchasePeriodStart || purchasePeriodEnd);

  const displayedRows = useMemo(() => {
    if (!hasPurchaseFilter) return baseRows;
    return baseRows.filter((row) => inPeriod(row.purchaseDate, purchasePeriodStart, purchasePeriodEnd));
  }, [baseRows, hasPurchaseFilter, purchasePeriodStart, purchasePeriodEnd]);

  useEffect(() => {
    const updateWidth = () => setTableScrollWidth(tableRef.current?.scrollWidth ?? 0);
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [displayedRows.length, activeSheet]);

  const sheetTotals = useMemo(() => {
    return displayedRows.reduce(
      (acc, row) => {
        const qty = Math.max(0, row.quantity || 0);
        const profit = calcNetProfit(row, settings) * qty;
        acc.quantity += qty;
        acc.purchase += row.purchasePrice * qty;
        acc.sales += row.targetPrice * qty;
        acc.net += profit;
        return acc;
      },
      { quantity: 0, purchase: 0, sales: 0, net: 0 },
    );
  }, [displayedRows, settings]);

  const soldTotals = useMemo(() => {
    return soldRows.reduce(
      (acc, row) => {
        const qty = Math.max(0, row.quantity || 0);
        acc.quantity += qty;
        acc.sales += row.targetPrice * qty;
        acc.net += calcNetProfit(row, settings) * qty;
        return acc;
      },
      { quantity: 0, sales: 0, net: 0 },
    );
  }, [soldRows, settings]);

  const salePeriodTotals = useMemo(() => {
    return soldRows.reduce(
      (acc, row) => {
        if (!inPeriod(row.saleDate, salePeriodStart, salePeriodEnd)) return acc;
        const qty = Math.max(0, row.quantity || 0);
        acc.quantity += qty;
        acc.sales += row.targetPrice * qty;
        acc.net += calcNetProfit(row, settings) * qty;
        return acc;
      },
      { quantity: 0, sales: 0, net: 0 },
    );
  }, [soldRows, settings, salePeriodStart, salePeriodEnd]);

  const purchasePeriodTotals = useMemo(() => {
    return baseRows.reduce(
      (acc, row) => {
        if (!inPeriod(row.purchaseDate, purchasePeriodStart, purchasePeriodEnd)) return acc;
        const qty = Math.max(0, row.quantity || 0);
        acc.quantity += qty;
        acc.purchase += row.purchasePrice * qty;
        return acc;
      },
      { quantity: 0, purchase: 0 },
    );
  }, [baseRows, purchasePeriodStart, purchasePeriodEnd]);

  const tabCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const qty = Math.max(0, row.quantity || 0);
        if (row.saleDate) acc.sold += qty;
        else acc.inventory += qty;
        return acc;
      },
      {
        inventory: 0,
        sold: 0,
      },
    );
  }, [rows]);

  const updateRow = <K extends keyof InventoryRow>(
    id: string,
    key: K,
    value: InventoryRow[K],
  ) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  };

  const addRows = (count: number) => {
    const newRows = emptyRows(count);
    if (hasPurchaseFilter) {
      newRows.forEach((row) => {
        row.purchaseDate = purchasePeriodEnd || purchasePeriodStart;
      });
    }
    pendingFocusId.current = newRows[0].id;
    setActiveSheet("inventory");
    setRows((current) => [...current, ...newRows]);
  };

  const copyPreviousRow = () => {
    const previous = displayedRows[displayedRows.length - 1];
    if (!previous) return;
    const copied: InventoryRow = {
      ...previous,
      id: crypto.randomUUID(),
      selected: false,
    };
    pendingFocusId.current = copied.id;
    setRows((current) => [...current, copied]);
  };

  const deleteRow = (id: string) => {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : emptyRows();
    });
  };

  const copyText = async () => {
    const picked = displayedRows.filter((row) => row.selected && (row.modelNumber.trim() || row.cardName.trim()));
    if (!picked.length) {
      setCopyStatus("empty");
      return;
    }

    const body = picked
      .map((row) => {
        const price = row.targetPrice ? `${yen.format(row.targetPrice)}円` : "価格相談";
        const psa = row.psaChecked ? ` ${row.psaRank}` : "";
        const note = row.note ? ` / ${row.note}` : "";
        const qtyText = row.quantity === null ? "" : ` ×${row.quantity}`;
        return `・${row.title} ${row.modelNumber} ${row.cardName}${psa} ${row.rarity} (${row.condition})${qtyText} : ${price}${note}`;
      })
      .join("\n");

    const totalQty = picked.reduce((sum, row) => sum + Math.max(0, row.quantity || 0), 0);
    const totalSales = picked.reduce(
      (sum, row) => sum + row.targetPrice * Math.max(0, row.quantity || 0),
      0,
    );

    const text = `【販売・譲渡リスト】\n${body}\n--------------------\n計 ${totalQty}点 / 総額 ${yen.format(
      totalSales,
    )}円\n※詳細・ご購入希望はDMまでお気軽にご連絡ください。`;

    await navigator.clipboard.writeText(text);
    setCopyStatus("copied");
    window.setTimeout(() => setCopyStatus("idle"), 1800);
  };

  const exportData = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
      rows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trading-card-inventory-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ImportPayload | unknown[];
      const payload = Array.isArray(parsed) ? { rows: parsed } : parsed;
      const nextRows = Array.isArray(payload.rows) ? payload.rows.map(normalizeRow) : [];
      if (!nextRows.length) throw new Error("No rows");
      setRows(nextRows);
      if (payload.settings) {
        setSettings({
          feeRate: Number.isFinite(payload.settings.feeRate) ? Number(payload.settings.feeRate) : settings.feeRate,
          shipping: Number.isFinite(payload.settings.shipping) ? Number(payload.settings.shipping) : settings.shipping,
        });
      }
      setImportStatus("done");
    } catch {
      setImportStatus("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.setTimeout(() => setImportStatus("idle"), 1800);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f7f9] pb-24 text-slate-900 sm:pb-[22rem]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold tracking-normal">爆速トレカ在庫管理シート</h1>
            <p className="text-[11px] text-slate-500">LocalStorage / 手数料10% / 送料210円</p>
          </div>
          <div className="header-actions">
            <button
              className={`pro-button ${isPro ? "is-active" : ""}`}
              type="button"
              onClick={() => openUpgrade()}
              title="月額プラン"
              aria-label="月額プラン"
            >
              {isPro ? <BadgeCheck size={16} /> : <Crown size={16} />}
              {isPro ? "Pro利用中" : "Pro"}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              title="設定"
              aria-label="設定"
            >
              <Settings2 size={18} />
            </button>
          </div>
        </div>
        {settingsOpen && (
          <section className="mx-auto mt-2 grid max-w-7xl grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-2">
            <label className="field-label">
              手数料 %
              <input
                className="compact-input"
                inputMode="decimal"
                value={Math.round(settings.feeRate * 1000) / 10}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    feeRate: Math.max(0, toNumber(event.target.value) / 100),
                  }))
                }
              />
            </label>
            <label className="field-label">
              送料 円
              <input
                className="compact-input"
                inputMode="numeric"
                value={settings.shipping}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    shipping: Math.max(0, Math.round(toNumber(event.target.value))),
                  }))
                }
              />
            </label>
          </section>
        )}
      </header>

      <section className="mx-auto max-w-7xl px-2 py-3">
        <nav className="sheet-tabs" aria-label="シート切り替え">
          <button
            className={`sheet-tab ${activeSheet === "inventory" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveSheet("inventory")}
          >
            在庫
            <span>{yen.format(tabCounts.inventory)}</span>
          </button>
          <button
            className={`sheet-tab ${activeSheet === "sold" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveSheet("sold")}
          >
            売却済
            <span>{yen.format(tabCounts.sold)}</span>
          </button>
        </nav>
        {!isPro && (
          <aside className="ad-banner" aria-label="広告枠">
            <div>
              <span>広告枠</span>
              <strong>広告表示エリア</strong>
            </div>
            <button type="button" onClick={() => requirePro("ads")}>
              広告を消す
            </button>
          </aside>
        )}
        <div
          className="top-scrollbar"
          ref={topScrollerRef}
          onScroll={() => syncHorizontalScroll("top")}
          aria-label="表の横スクロール"
        >
          <div style={{ width: tableScrollWidth || 1 }} />
        </div>
        <div
          className="table-scroll-area overflow-x-auto border-y border-slate-200 bg-white shadow-sm"
          ref={tableScrollerRef}
          onScroll={() => syncHorizontalScroll("table")}
        >
          <table className="inventory-table" ref={tableRef}>
            <thead>
              <tr>
                <th className="w-8">選</th>
                <th className="w-[86px]">タイトル</th>
                <th className="w-[132px]">型番</th>
                <th className="w-[150px]">カード名</th>
                <th className="w-[150px]">備考</th>
                <th className="w-[74px]">レア度</th>
                <th className="w-[58px]">枚数</th>
                <th className="w-[92px]">仕入れ値</th>
                <th className="w-[92px]">売却価格</th>
                <th className="w-[76px]">手数料%</th>
                <th className="w-[82px]">送料</th>
                <th className="w-[124px]">購入日</th>
                <th className="w-[124px]">売却日</th>
                <th className="w-[82px]">状態</th>
                <th className="w-[54px]">PSA</th>
                <th className="w-[86px]">ランク</th>
                <th className="w-[96px]">手残り</th>
                <th className="w-[124px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {!displayedRows.length && (
                <tr>
                  <td className="empty-cell" colSpan={18}>
                    {activeSheet === "inventory"
                      ? "在庫行はありません。行を追加するか、売却済の売却日を空にすると戻せます。"
                      : "売却済行はありません。在庫シートで売却日を入れると自動で移動します。"}
                  </td>
                </tr>
              )}
              {displayedRows.map((row) => {
                const net = calcNetProfit(row, settings);
                const hasSearch = Boolean(searchText(row));
                return (
                  <tr key={row.id}>
                    <td>
                      <button
                        className={`check-button ${row.selected ? "is-on" : ""}`}
                        type="button"
                        onClick={() => updateRow(row.id, "selected", !row.selected)}
                        aria-label="行を選択"
                        title="行を選択"
                      >
                        {row.selected && <Check size={13} />}
                      </button>
                    </td>
                    <td>
                      <select
                        className="cell-select"
                        value={row.title}
                        onChange={(event) => updateRow(row.id, "title", event.target.value as Title)}
                      >
                        {titles.map((title) => (
                          <option key={title}>{title}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        ref={(element) => {
                          inputRefs.current[row.id] = element;
                        }}
                        className="cell-input"
                        value={row.modelNumber}
                        onChange={(event) => updateRow(row.id, "modelNumber", event.target.value)}
                        placeholder="OP01-001"
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        value={row.cardName}
                        onChange={(event) => updateRow(row.id, "cardName", event.target.value)}
                        placeholder="カード名"
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        value={row.note}
                        onChange={(event) => updateRow(row.id, "note", event.target.value)}
                        placeholder="備考"
                      />
                    </td>
                    <td>
                      <select
                        className="cell-select"
                        value={row.rarity}
                        onChange={(event) => updateRow(row.id, "rarity", event.target.value as Rarity)}
                      >
                        {rarities.map((rarity) => (
                          <option key={rarity}>{rarity}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="cell-input text-right"
                        inputMode="numeric"
                        value={row.quantity ?? ""}
                        onChange={(event) =>
                          updateRow(
                            row.id,
                            "quantity",
                            event.target.value === "" ? null : Math.max(0, Math.round(toNumber(event.target.value))),
                          )
                        }
                        placeholder="枚"
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input text-right"
                        inputMode="numeric"
                        value={row.purchasePrice || ""}
                        onChange={(event) =>
                          updateRow(row.id, "purchasePrice", Math.max(0, Math.round(toNumber(event.target.value))))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input text-right"
                        inputMode="numeric"
                        value={row.targetPrice || ""}
                        onChange={(event) =>
                          updateRow(row.id, "targetPrice", Math.max(0, Math.round(toNumber(event.target.value))))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input text-right"
                        inputMode="decimal"
                        value={row.feeRatePercent ?? ""}
                        onChange={(event) =>
                          updateRow(
                            row.id,
                            "feeRatePercent",
                            event.target.value === "" ? null : Math.max(0, toNumber(event.target.value)),
                          )
                        }
                        placeholder={`${Math.round(settings.feeRate * 1000) / 10}`}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input text-right"
                        inputMode="numeric"
                        value={row.shippingFee ?? ""}
                        onChange={(event) =>
                          updateRow(
                            row.id,
                            "shippingFee",
                            event.target.value === "" ? null : Math.max(0, Math.round(toNumber(event.target.value))),
                          )
                        }
                        placeholder={`${settings.shipping}`}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input date-input"
                        type="date"
                        value={row.purchaseDate}
                        onChange={(event) => updateRow(row.id, "purchaseDate", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input date-input"
                        type="date"
                        value={row.saleDate}
                        onChange={(event) => updateRow(row.id, "saleDate", event.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        className={`condition-pill ${conditionClass(row.condition)}`}
                        type="button"
                        onClick={() => updateRow(row.id, "condition", nextCondition(row.condition))}
                      >
                        {row.condition}
                      </button>
                    </td>
                    <td>
                      <button
                        className={`check-button ${row.psaChecked ? "is-on" : ""}`}
                        type="button"
                        onClick={() => updateRow(row.id, "psaChecked", !row.psaChecked)}
                        aria-label="PSAチェック"
                        title="PSAチェック"
                      >
                        {row.psaChecked && <Check size={13} />}
                      </button>
                    </td>
                    <td>
                      <select
                        className="cell-select"
                        value={row.psaRank}
                        disabled={!row.psaChecked}
                        onChange={(event) => updateRow(row.id, "psaRank", event.target.value as PsaRank)}
                      >
                        {psaRanks.map((rank) => (
                          <option key={rank}>{rank}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <output className={`net-cell ${net < 0 ? "is-minus" : "is-plus"}`}>
                        {yen.format(net)}
                      </output>
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className={`action-button ${!isPro && hasSearch ? "is-locked" : ""}`}
                          type="button"
                          onClick={() => (isPro ? openMercari(row) : requirePro("search"))}
                          disabled={!hasSearch}
                          aria-label="メルカリ検索"
                          title={isPro ? "メルカリ検索" : "Proでメルカリ検索"}
                        >
                          {isPro ? <Search size={14} /> : <Lock size={13} />}
                          <span>M</span>
                        </button>
                        <button
                          className={`action-button ${!isPro && hasSearch ? "is-locked" : ""}`}
                          type="button"
                          onClick={() => (isPro ? openX(row) : requirePro("search"))}
                          disabled={!hasSearch}
                          aria-label="X検索"
                          title={isPro ? "X検索" : "ProでX検索"}
                        >
                          {isPro ? <XIcon size={14} /> : <Lock size={13} />}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => deleteRow(row.id)}
                          aria-label="削除"
                          title="削除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className={`bottom-sheet ${bottomSheetOpen ? "is-open" : ""}`}>
        <div className="mx-auto grid max-w-7xl gap-2">
          <div className="bottom-sheet-header">
            <span>集計・操作</span>
            <button
              className="icon-button sheet-close-button"
              type="button"
              onClick={() => setBottomSheetOpen(false)}
              aria-label="閉じる"
              title="閉じる"
            >
              <XIcon size={17} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            <div className="metric">
              <span>{activeSheet === "inventory" ? "在庫枚数" : "売却済枚数"}</span>
              <strong>{yen.format(sheetTotals.quantity)}</strong>
            </div>
            <div className="metric">
              <span>{activeSheet === "inventory" ? "在庫仕入額" : "売却総額"}</span>
              <strong>{yen.format(activeSheet === "inventory" ? sheetTotals.purchase : sheetTotals.sales)}円</strong>
            </div>
            <div className="metric">
              <span>{activeSheet === "inventory" ? "想定純利益" : "売却仕入額"}</span>
              <strong className={activeSheet === "inventory" && sheetTotals.net < 0 ? "text-red-600" : "text-emerald-700"}>
                {yen.format(activeSheet === "inventory" ? sheetTotals.net : sheetTotals.purchase)}円
              </strong>
            </div>
            <div className="metric">
              <span>{activeSheet === "inventory" ? "売却済利益" : "実際の総利益"}</span>
              <strong className={(activeSheet === "inventory" ? soldTotals.net : sheetTotals.net) < 0 ? "text-red-600" : "text-emerald-700"}>
                {yen.format(activeSheet === "inventory" ? soldTotals.net : sheetTotals.net)}円
              </strong>
            </div>
          </div>

          <section className={`period-grid ${isPro ? "" : "is-locked"}`}>
            <div className="period-panel">
              <div className="period-title">売却期間</div>
              <div className="period-fields">
                <label>
                  開始
                  <input
                    className="compact-input"
                    type="date"
                    value={salePeriodStart}
                    disabled={!isPro}
                    onChange={(event) => setSalePeriodStart(event.target.value)}
                  />
                </label>
                <label>
                  終了
                  <input
                    className="compact-input"
                    type="date"
                    value={salePeriodEnd}
                    disabled={!isPro}
                    onChange={(event) => setSalePeriodEnd(event.target.value)}
                  />
                </label>
              </div>
              <div className="period-results">
                <span>{yen.format(salePeriodTotals.quantity)}点</span>
                <span>{yen.format(salePeriodTotals.sales)}円</span>
                <strong className={salePeriodTotals.net < 0 ? "text-red-600" : "text-emerald-700"}>
                  {yen.format(salePeriodTotals.net)}円
                </strong>
              </div>
            </div>
            <div className="period-panel">
              <div className="period-title">仕入れ期間</div>
              <div className="period-fields">
                <label>
                  開始
                  <input
                    className="compact-input"
                    type="date"
                    value={purchasePeriodStart}
                    disabled={!isPro}
                    onChange={(event) => setPurchasePeriodStart(event.target.value)}
                  />
                </label>
                <label>
                  終了
                  <input
                    className="compact-input"
                    type="date"
                    value={purchasePeriodEnd}
                    disabled={!isPro}
                    onChange={(event) => setPurchasePeriodEnd(event.target.value)}
                  />
                </label>
              </div>
              <div className="period-results period-results-compact">
                <span>{yen.format(purchasePeriodTotals.quantity)}点</span>
                <strong>{yen.format(purchasePeriodTotals.purchase)}円</strong>
              </div>
            </div>
            {!isPro && (
              <button className="period-lock" type="button" onClick={() => requirePro("period")}>
                <Lock size={15} />
                期間集計はProで利用
              </button>
            )}
          </section>

          <div className="footer-actions">
            <button className="primary-button" type="button" onClick={() => addRows(1)}>
              <Plus size={17} />
              1行追加
            </button>
            <button className="primary-button" type="button" onClick={() => addRows(10)}>
              <Plus size={17} />
              10行追加
            </button>
            <button
              className="primary-button muted-primary"
              type="button"
              onClick={copyPreviousRow}
              disabled={!displayedRows.length}
            >
              <Copy size={17} />
              前行複製
            </button>
            <button className="copy-button footer-copy-button" type="button" onClick={copyText}>
              <Copy size={17} />
              {copyStatus === "copied"
                ? "コピー済み"
                : copyStatus === "empty"
                  ? "選択なし"
                  : "コピペ用テキスト生成"}
            </button>
            <button
              className={`icon-action-button ${isPro ? "" : "is-locked"}`}
              type="button"
              onClick={() => (isPro ? exportData() : requirePro("importExport"))}
              title={isPro ? "エクスポート" : "Proでエクスポート"}
              aria-label={isPro ? "エクスポート" : "Proでエクスポート"}
            >
              {isPro ? <Download size={18} /> : <Lock size={16} />}
            </button>
            <button
              className={`icon-action-button ${importStatus === "error" ? "is-error" : ""} ${isPro ? "" : "is-locked"}`}
              type="button"
              onClick={() => (isPro ? fileInputRef.current?.click() : requirePro("importExport"))}
              title={isPro ? "インポート" : "Proでインポート"}
              aria-label={isPro ? "インポート" : "Proでインポート"}
            >
              {isPro ? <Upload size={18} /> : <Lock size={16} />}
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importData(event.target.files?.[0])}
            />
          </div>
          {importStatus !== "idle" && (
            <p className={`status-line ${importStatus === "error" ? "is-error" : ""}`}>
              {importStatus === "done" ? "インポート完了" : "インポート失敗"}
            </p>
          )}
        </div>
      </footer>
      {!bottomSheetOpen && (
        <button
          className="bottom-sheet-toggle"
          type="button"
          onClick={() => setBottomSheetOpen(true)}
          aria-label="集計・操作を開く"
        >
          集計・操作
        </button>
      )}
      {upgradeOpen && (
        <div className="upgrade-backdrop" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
          <section className="upgrade-modal">
            <div className="upgrade-modal-header">
              <div>
                <p>{isPro ? "現在のプラン" : "月額プラン"}</p>
                <h2 id="upgrade-title">爆速トレカ在庫管理 Pro</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setUpgradeOpen(false)}
                aria-label="閉じる"
                title="閉じる"
              >
                <XIcon size={18} />
              </button>
            </div>
            {upgradeReason && !isPro && (
              <div className="upgrade-reason">
                <Lock size={15} />
                {featureLabels[upgradeReason]}はPro機能です
              </div>
            )}
            <div className="upgrade-price">
              <strong>{isPro ? "Pro利用中" : PRO_PRICE_LABEL}</strong>
              <span>広告非表示 / 検索 / 期間集計 / バックアップ機能</span>
            </div>
            <ul className="upgrade-list">
              <li>広告枠を非表示</li>
              <li>インポート / エクスポート</li>
              <li>検索・期間集計を制限なしで利用</li>
            </ul>
            <button
              className={`upgrade-cta ${isPro ? "is-complete" : ""}`}
              type="button"
              onClick={startCheckout}
              disabled={isPro}
            >
              {isPro ? (
                <>
                  <BadgeCheck size={17} />
                  Proが有効です
                </>
              ) : (
                <>
                  <CreditCard size={17} />
                  {PRO_PRICE_LABEL}で開始
                </>
              )}
            </button>
            {checkoutStatus === "missing" && (
              <p className="upgrade-note is-warning">
                決済リンクが未設定です。Stripe Payment Linkを作成し、VITE_STRIPE_PAYMENT_LINKに設定してください。
              </p>
            )}
            {!isPro && (
              <p className="upgrade-note">
                決済成功URLは /app?billing=success、キャンセルURLは /app?billing=free に設定してください。現在はLocalStorageでPro状態を保持します。
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/") return <HomePage />;
  if (path === "/app") return <InventoryApp />;
  if (path === "/pricing") return <PricingPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/contact") return <ContactPage />;
  return <NotFoundPage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
