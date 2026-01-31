import CryptoJS from "crypto-js";

const MEXC_BASE_URL = "https://api.mexc.com";

export interface MexcCredentials {
  apiKey: string;
  secretKey: string;
}

interface MexcResponse<T = any> {
  code?: number;
  msg?: string;
  data?: T;
}

export interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openPrice: string;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
}

export interface AccountInfo {
  balances: Balance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
}

export interface Order {
  symbol: string;
  orderId: string;
  clientOrderId?: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  type: string;
  side: string;
  transactTime: number;
}

export interface PlaceOrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "LIMIT_MAKER";
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
}

class MexcAPI {
  private credentials: MexcCredentials | null = null;

  setCredentials(creds: MexcCredentials) {
    this.credentials = creds;
  }

  hasCredentials(): boolean {
    return this.credentials !== null;
  }

  private sign(queryString: string): string {
    if (!this.credentials) throw new Error("Credentials not set");
    return CryptoJS.HmacSHA256(queryString, this.credentials.secretKey).toString();
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params: Record<string, any> = {},
    signed: boolean = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.credentials) {
      headers["X-MEXC-APIKEY"] = this.credentials.apiKey;
    }

    let url = `${MEXC_BASE_URL}${endpoint}`;
    let body: string | undefined;

    if (signed) {
      params.timestamp = Date.now().toString();
      const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      params.signature = this.sign(queryString);
    }

    if (method === "GET" || method === "DELETE") {
      const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      if (queryString) {
        url += `?${queryString}`;
      }
    } else {
      const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      const data = await response.json();
      
      if (data.code && data.code !== 0) {
        console.error(`MEXC API Error: ${data.msg}`);
      }

      return data;
    } catch (error) {
      console.error("MEXC API request failed:", error);
      throw error;
    }
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    try {
      const data = await this.request<Ticker>(
        "GET",
        "/api/v3/ticker/24hr",
        { symbol }
      );
      return data;
    } catch {
      return null;
    }
  }

  async getTickers(): Promise<Ticker[]> {
    try {
      const data = await this.request<Ticker[]>("GET", "/api/v3/ticker/24hr");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getPrice(symbol: string): Promise<{ symbol: string; price: string } | null> {
    try {
      const data = await this.request<{ symbol: string; price: string }>(
        "GET",
        "/api/v3/ticker/price",
        { symbol }
      );
      return data;
    } catch {
      return null;
    }
  }

  async getAccountInfo(): Promise<AccountInfo | null> {
    try {
      const data = await this.request<AccountInfo>(
        "GET",
        "/api/v3/account",
        {},
        true
      );
      return data;
    } catch {
      return null;
    }
  }

  async getBalance(): Promise<Balance[]> {
    const account = await this.getAccountInfo();
    if (account?.balances) {
      return account.balances.filter(
        (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      );
    }
    return [];
  }

  async placeOrder(params: PlaceOrderParams): Promise<Order | null> {
    try {
      const orderParams: Record<string, any> = {
        symbol: params.symbol,
        side: params.side,
        type: params.type,
      };

      if (params.quantity) orderParams.quantity = params.quantity;
      if (params.quoteOrderQty) orderParams.quoteOrderQty = params.quoteOrderQty;
      if (params.price) orderParams.price = params.price;

      const data = await this.request<Order>(
        "POST",
        "/api/v3/order",
        orderParams,
        true
      );
      return data;
    } catch {
      return null;
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      await this.request<any>(
        "DELETE",
        "/api/v3/order",
        { symbol, orderId },
        true
      );
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    try {
      const params: Record<string, any> = {};
      if (symbol) params.symbol = symbol;
      
      const data = await this.request<Order[]>(
        "GET",
        "/api/v3/openOrders",
        params,
        true
      );
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getOrderHistory(symbol: string, limit = 100): Promise<Order[]> {
    try {
      const data = await this.request<Order[]>(
        "GET",
        "/api/v3/allOrders",
        { symbol, limit },
        true
      );
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async buyMarket(symbol: string, quoteAmount: string): Promise<Order | null> {
    return this.placeOrder({
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: quoteAmount,
    });
  }

  async sellMarket(symbol: string, quantity: string): Promise<Order | null> {
    return this.placeOrder({
      symbol,
      side: "SELL",
      type: "MARKET",
      quantity,
    });
  }

  async buyLimit(symbol: string, quantity: string, price: string): Promise<Order | null> {
    return this.placeOrder({
      symbol,
      side: "BUY",
      type: "LIMIT",
      quantity,
      price,
    });
  }

  async sellLimit(symbol: string, quantity: string, price: string): Promise<Order | null> {
    return this.placeOrder({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity,
      price,
    });
  }

  async placeTpSlOrders(
    symbol: string,
    quantity: string,
    side: "BUY" | "SELL",
    tp?: string,
    sl?: string
  ): Promise<{ tpOrder?: Order | null; slOrder?: Order | null }> {
    const result: { tpOrder?: Order | null; slOrder?: Order | null } = {};

    if (tp) {
      result.tpOrder = await this.placeOrder({
        symbol,
        side: side === "BUY" ? "SELL" : "BUY",
        type: "LIMIT",
        quantity,
        price: tp,
      });
    }

    if (sl) {
      result.slOrder = await this.placeOrder({
        symbol,
        side: side === "BUY" ? "SELL" : "BUY",
        type: "LIMIT",
        quantity,
        price: sl,
      });
    }

    return result;
  }
}

export const mexcApi = new MexcAPI();
