declare module "*.mjs" {
  const factory: (opts: {
    noInitialRun?: boolean;
    print?: (s: string) => void;
    printErr?: (s: string) => void;
  }) => Promise<{ callMain: (args: string[]) => number }>;
  export default factory;
}
