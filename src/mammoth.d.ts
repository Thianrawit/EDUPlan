declare module 'mammoth' {
  export interface MammothResult {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  export function extractRawText(input: {
    arrayBuffer?: ArrayBuffer;
    buffer?: any;
    path?: string;
  }): Promise<MammothResult>;

  export const images: {
    imgElement: (fn: (image: any) => Promise<{ src: string }>) => any;
    dataUri?: any;
  };

  export function convertToHtml(
    input: {
      arrayBuffer?: ArrayBuffer;
      buffer?: any;
      path?: string;
    },
    options?: Record<string, any>
  ): Promise<MammothResult>;
}
