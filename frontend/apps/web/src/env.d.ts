interface ImportMetaEnv {
  readonly WULING_INDEXABLE: boolean;
  readonly WULING_PUBLIC_ORIGIN: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.css';
