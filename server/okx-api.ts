import CryptoJS from "crypto-js";

const OKX_BASE_URL = "https://www.okx.com";

export interface OkxCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  demo?: boolean; // Use demo trading mode
}

interface OkxResponse<T = any> {
  code: string;
  msg: string;
  data: T;
}

export interface Ticker {
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  volCcy24h: string;
  ts: string;
}

export interface Balance {
  ccy: string;
  bal: string;
  availBal: string;
  frozenBal: string;
  uTime: string;
}

export interface AccountBalance {
  totalEq: string;
  isoEq: string;
  details: Balance[];
}

export interface Position {
  instId: string;
  instType: string;
  mgnMode: string;
  posId: string;
  posSide: string;
  pos: string;
  posCcy: string;
  availPos: string;
  avgPx: string;
  upl: string;
  uplRatio: string;
  lever: string;
  liqPx: string;
  markPx: string;
  margin: string;
  mgnRatio: string;
  notionalUsd: string;
  cTime: string;
  uTime: string;
}

export interface Order {
  instId: string;
  ordId: string;
  clOrdId?: string;
  state: string;
  side: string;
  ordType: string;
  sz: string;
  px?: string;
  avgPx: string;
  fillSz: string;
  accFillSz: string;
  fee: string;
  feeCcy: string;
  pnl: string;
  lever?: string;
  cTime: string;
  uTime: string;
}

export interface PlaceOrderParams {
  instId: string;
  tdMode: "cash" | "cross" | "isolated";
  side: "buy" | "sell";
  ordType: "market" | "limit" | "post_only" | "fok" | "ioc";
  sz: string;
  px?: string; // Required for limit orders
  posSide?: "long" | "short" | "net"; // For futures
  clOrdId?: string;
}

class OkxAPI {
  private credentials: OkxCredentials | null = null;

  setCredentials(creds: OkxCredentials) {
    this.credentials = creds;
  }

  hasCredentials(): boolean {
    return this.credentials !== null;
  }

  private sign(
    timestamp: string,
    method: string,
    path: string,
    body: string = ""
  ): string {
    if (!this.credentials) throw new Error("No credentials set");
    const message = timestamp + method.toUpperCase() + path + body;
    const hash = CryptoJS.HmacSHA256(message, this.credentials.secretKey);
    return CryptoJS.enc.Base64.stringify(hash);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    auth: boolean = true
  ): Promise<OkxResponse<T>> {
    const url = `${OKX_BASE_URL}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (auth) {
      if (!this.credentials) {
        throw new Error("OKX credentials not set");
      }

      const timestamp = new Date().toISOString();
      const bodyString = body ? JSON.stringify(body) : "";
      const signature = this.sign(timestamp, method, path, bodyString);

      headers["OK-ACCESS-KEY"] = this.credentials.apiKey;
      headers["OK-ACCESS-SIGN"] = signature;
      headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      headers["OK-ACCESS-PASSPHRASE"] = this.credentials.passphrase;

      // Demo trading mode
      if (this.credentials.demo) {
        headers["x-simulated-trading"] = "1";
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();
      return data as OkxResponse<T>;
    } catch (error) {
      console.error("OKX API error:", error);
      throw error;
    }
  }

  // ============ Public Endpoints (no auth) ============

  // Get ticker for a specific instrument
  async getTicker(instId: string): Promise<Ticker | null> {
    const response = await this.request<Ticker[]>(
      "GET",
      `/api/v5/market/ticker?instId=${instId}`,
      undefined,
      false
    );
    if (response.code === "0" && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  }

  // Get all tickers for a type (SPOT, FUTURES, SWAP)
  async getTickers(
    instType: "SPOT" | "FUTURES" | "SWAP" = "SPOT"
  ): Promise<Ticker[]> {
    const response = await this.request<Ticker[]>(
      "GET",
      `/api/v5/market/tickers?instType=${instType}`,
      undefined,
      false
    );
    if (response.code === "0") {
      return response.data;
    }
    return [];
  }

  // Get instruments
  async getInstruments(
    instType: "SPOT" | "FUTURES" | "SWAP" = "SPOT"
  ): Promise<any[]> {
    const response = await this.request<any[]>(
      "GET",
      `/api/v5/public/instruments?instType=${instType}`,
      undefined,
      false
    );
    if (response.code === "0") {
      return response.data;
    }
    return [];
  }

  // ============ Private Endpoints (requires auth) ============

  // Get account balance
  async getBalance(): Promise<AccountBalance | null> {
    const response = await this.request<AccountBalance[]>(
      "GET",
      "/api/v5/account/balance"
    );
    if (response.code === "0" && response.data.length > 0) {
      return response.data[0];
    }
    console.error("Balance error:", response);
    return null;
  }

  // Get positions (for futures/swap)
  async getPositions(instType?: string): Promise<Position[]> {
    let path = "/api/v5/account/positions";
    if (instType) {
      path += `?instType=${instType}`;
    }
    const response = await this.request<Position[]>("GET", path);
    if (response.code === "0") {
      return response.data;
    }
    console.error("Positions error:", response);
    return [];
  }

  // Place order
  async placeOrder(params: PlaceOrderParams): Promise<Order | null> {
    const response = await this.request<any[]>(
      "POST",
      "/api/v5/trade/order",
      params
    );
    if (response.code === "0" && response.data.length > 0) {
      const result = response.data[0];
      if (result.sCode === "0") {
        return result;
      }
      console.error("Order error:", result.sMsg);
      return null;
    }
    console.error("Order error:", response);
    return null;
  }

  // Cancel order
  async cancelOrder(
    instId: string,
    ordId: string
  ): Promise<boolean> {
    const response = await this.request<any[]>("POST", "/api/v5/trade/cancel-order", {
      instId,
      ordId,
    });
    if (response.code === "0" && response.data.length > 0) {
      return response.data[0].sCode === "0";
    }
    return false;
  }

  // Get open orders
  async getOpenOrders(instType?: string): Promise<Order[]> {
    let path = "/api/v5/trade/orders-pending";
    if (instType) {
      path += `?instType=${instType}`;
    }
    const response = await this.request<Order[]>("GET", path);
    if (response.code === "0") {
      return response.data;
    }
    return [];
  }

  // Get order history
  async getOrderHistory(
    instType: "SPOT" | "FUTURES" | "SWAP" = "SPOT",
    limit: number = 100
  ): Promise<Order[]> {
    const response = await this.request<Order[]>(
      "GET",
      `/api/v5/trade/orders-history-archive?instType=${instType}&limit=${limit}`
    );
    if (response.code === "0") {
      return response.data;
    }
    return [];
  }

  // Set leverage (for futures)
  async setLeverage(
    instId: string,
    lever: string,
    mgnMode: "cross" | "isolated"
  ): Promise<boolean> {
    const response = await this.request<any[]>("POST", "/api/v5/account/set-leverage", {
      instId,
      lever,
      mgnMode,
    });
    return response.code === "0";
  }

  // ============ Algo Orders (TP/SL) ============

  // Place algo order for TP/SL
  async placeAlgoOrder(params: {
    instId: string;
    tdMode: "cash" | "cross" | "isolated";
    side: "buy" | "sell";
    ordType: "conditional" | "oco" | "trigger";
    sz: string;
    posSide?: "long" | "short" | "net";
    tpTriggerPx?: string;
    tpOrdPx?: string;
    slTriggerPx?: string;
    slOrdPx?: string;
  }): Promise<any> {
    const body: any = {
      instId: params.instId,
      tdMode: params.tdMode,
      side: params.side,
      ordType: params.ordType,
      sz: params.sz,
    };

    if (params.posSide) body.posSide = params.posSide;
    if (params.tpTriggerPx) {
      body.tpTriggerPx = params.tpTriggerPx;
      body.tpOrdPx = params.tpOrdPx || "-1"; // -1 means market price
    }
    if (params.slTriggerPx) {
      body.slTriggerPx = params.slTriggerPx;
      body.slOrdPx = params.slOrdPx || "-1"; // -1 means market price
    }

    const response = await this.request<any[]>("POST", "/api/v5/trade/order-algo", body);
    if (response.code === "0" && response.data.length > 0) {
      return response.data[0];
    }
    console.error("Failed to place algo order:", response.msg);
    return null;
  }

  // ============ Convenience Methods ============

  // Buy market order (spot) with optional TP/SL
  async buySpot(instId: string, amount: string, tp?: string, sl?: string): Promise<Order | null> {
    const order = await this.placeOrder({
      instId,
      tdMode: "cash",
      side: "buy",
      ordType: "market",
      sz: amount,
    });

    // If TP or SL is set, create conditional orders
    if (order && (tp || sl)) {
      // For spot, we create a sell order when TP/SL is triggered
      if (tp) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cash",
          side: "sell",
          ordType: "conditional",
          sz: amount,
          tpTriggerPx: tp,
        });
      }
      if (sl) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cash",
          side: "sell",
          ordType: "conditional",
          sz: amount,
          slTriggerPx: sl,
        });
      }
    }

    return order;
  }

  // Sell market order (spot) with optional TP/SL
  async sellSpot(instId: string, amount: string, tp?: string, sl?: string): Promise<Order | null> {
    const order = await this.placeOrder({
      instId,
      tdMode: "cash",
      side: "sell",
      ordType: "market",
      sz: amount,
    });

    return order;
  }

  // Open long position (futures/swap) with optional TP/SL
  async openLong(
    instId: string,
    size: string,
    leverage: string = "10",
    tp?: string,
    sl?: string
  ): Promise<Order | null> {
    // Set leverage first
    await this.setLeverage(instId, leverage, "cross");

    const order = await this.placeOrder({
      instId,
      tdMode: "cross",
      side: "buy",
      posSide: "long",
      ordType: "market",
      sz: size,
    });

    // Create TP/SL algo orders
    if (order && (tp || sl)) {
      if (tp) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cross",
          side: "sell",
          posSide: "long",
          ordType: "conditional",
          sz: size,
          tpTriggerPx: tp,
        });
      }
      if (sl) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cross",
          side: "sell",
          posSide: "long",
          ordType: "conditional",
          sz: size,
          slTriggerPx: sl,
        });
      }
    }

    return order;
  }

  // Open short position (futures/swap) with optional TP/SL
  async openShort(
    instId: string,
    size: string,
    leverage: string = "10",
    tp?: string,
    sl?: string
  ): Promise<Order | null> {
    await this.setLeverage(instId, leverage, "cross");

    const order = await this.placeOrder({
      instId,
      tdMode: "cross",
      side: "sell",
      posSide: "short",
      ordType: "market",
      sz: size,
    });

    // Create TP/SL algo orders
    if (order && (tp || sl)) {
      if (tp) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cross",
          side: "buy",
          posSide: "short",
          ordType: "conditional",
          sz: size,
          tpTriggerPx: tp,
        });
      }
      if (sl) {
        await this.placeAlgoOrder({
          instId,
          tdMode: "cross",
          side: "buy",
          posSide: "short",
          ordType: "conditional",
          sz: size,
          slTriggerPx: sl,
        });
      }
    }

    return order;
  }

  // Close long position
  async closeLong(instId: string, size: string): Promise<Order | null> {
    return this.placeOrder({
      instId,
      tdMode: "cross",
      side: "sell",
      posSide: "long",
      ordType: "market",
      sz: size,
    });
  }

  // Close short position
  async closeShort(instId: string, size: string): Promise<Order | null> {
    return this.placeOrder({
      instId,
      tdMode: "cross",
      side: "buy",
      posSide: "short",
      ordType: "market",
      sz: size,
    });
  }
}

export const okxApi = new OkxAPI();
