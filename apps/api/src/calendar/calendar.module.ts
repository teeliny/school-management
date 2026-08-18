import { Module } from "@nestjs/common";
import { CalendarController, CalendarService } from "./calendar";

@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
