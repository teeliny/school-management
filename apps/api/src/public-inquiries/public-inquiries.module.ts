import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdmissionInquiryAdminController, AdmissionInquiryPublicController, AdmissionInquiryService } from "./admission-inquiry";
import {
  CareerContactInquiryAdminController,
  CareerContactInquiryPublicController,
  CareerContactInquiryService,
} from "./career-contact-inquiry";

// Marketing-site inquiry forms (admissions, careers & contact) — the app's
// first public write endpoints, so ThrottlerModule is scoped to this module
// alone (via each public controller's own @UseGuards(ThrottlerGuard)) and
// doesn't touch any other route's behavior.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 600_000, limit: 5 }]),
    NotificationsModule,
  ],
  controllers: [
    AdmissionInquiryPublicController,
    AdmissionInquiryAdminController,
    CareerContactInquiryPublicController,
    CareerContactInquiryAdminController,
  ],
  providers: [AdmissionInquiryService, CareerContactInquiryService],
})
export class PublicInquiriesModule {}
