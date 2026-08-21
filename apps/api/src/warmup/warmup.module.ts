import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { WarmupInterceptor } from "./warmup.interceptor";

@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: WarmupInterceptor }],
})
export class WarmupModule {}
