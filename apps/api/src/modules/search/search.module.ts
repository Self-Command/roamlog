import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { SearchController } from "./search.controller.js";
import { SearchRepository } from "./search.repository.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [AccessControlModule],
  controllers: [SearchController],
  providers: [SearchRepository, SearchService],
})
export class SearchModule {}
