import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { ExpenseTenantGuard } from "./expense-tenant.guard.js";
import { ExpensesController } from "./expenses.controller.js";
import { ExpensesRepository } from "./expenses.repository.js";
import { ExpensesService } from "./expenses.service.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, TripsModule],
  controllers: [ExpensesController],
  providers: [ExpensesRepository, ExpensesService, ExpenseTenantGuard],
  exports: [ExpensesService],
})
export class ExpensesModule {}
