describe('BggModule', () => {
  it('configures the BGG client with the application token', () => {
    const previousToken = process.env.BGG_API_TOKEN;
    process.env.BGG_API_TOKEN = 'test-bgg-token';

    try {
      jest.isolateModules(() => {
        // Load the dynamic module only after setting the environment variable;
        // HttpModule options are evaluated when BggModule is imported.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { HttpModule } = require('@nestjs/axios');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { BggModule } = require('./bgg.module');
        const imports = Reflect.getMetadata('imports', BggModule) as {
          module: typeof HttpModule;
          providers?: {
            provide: string;
            useValue: {
              defaults?: {
                headers?: { common?: Record<string, string>; Authorization?: string };
              };
            };
          }[];
        }[];
        const httpModule = imports.find((item) => item.module === HttpModule);
        const axiosInstance = httpModule?.providers?.find(
          (provider) => provider.provide === 'AXIOS_INSTANCE_TOKEN',
        )?.useValue;

        expect(axiosInstance?.defaults?.headers?.Authorization).toBe(
          'Bearer test-bgg-token',
        );
      });
    } finally {
      if (previousToken === undefined) delete process.env.BGG_API_TOKEN;
      else process.env.BGG_API_TOKEN = previousToken;
    }
  });
});
