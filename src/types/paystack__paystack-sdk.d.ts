declare module "@paystack/paystack-sdk" {
  export class Paystack {
    constructor(secretKey: string);

    transaction: {
      initialize(params: {
        email: string;
        amount: number;
        reference?: string;
        callback_url?: string;
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
      }): Promise<{ data: { authorization_url: string; access_code: string; reference: string } }>;
      verify(params: { reference: string }): Promise<{ data: Record<string, unknown> }>;
    };

    transferrecipient: {
      create(params: {
        type: "nuban" | "mobile_money" | "basa";
        name: string;
        account_number: string;
        bank_code: string;
        currency?: string;
        [key: string]: unknown;
      }): Promise<{ data: { recipient_code: string; [key: string]: unknown } }>;
    };

    transfer: {
      initiate(params: {
        source: "balance";
        amount: number;
        recipient: string;
        reason?: string;
        reference?: string;
        [key: string]: unknown;
      }): Promise<{ data: { transfer_code: string; [key: string]: unknown } }>;
    };

    verification: {
      resolveAccount(params: {
        account_number: string;
        bank_code: string;
      }): Promise<{
        data: { account_number: string; account_name: string; bank_id: number };
      }>;
    };

    refund: {
      create(params: {
        transaction: string;
        amount?: number;
        [key: string]: unknown;
      }): Promise<{ data: { reference: string; [key: string]: unknown } }>;
    };
  }
}
