// 매우 단순한 fetch wrapper — sample fixture용
export const apiClient = {
  async get<T = any>(url: string): Promise<T> {
    const res = await fetch(url);
    return res.json();
  },
  async post<T = any>(url: string, body: any): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};
