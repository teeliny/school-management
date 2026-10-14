import { ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

// The roster grid groups a class arm's papers for one exam day into a single
// row, so reassigning that row moves every paper's (same-role) assignment at
// once — transactionally, see InvigilationAssignmentService.reassign.
export class ReassignInvigilationAssignmentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("all", { each: true })
  ids!: string[];

  @IsUUID()
  staffId!: string;
}

// Group-level counterpart of SwapInvigilationAssignmentDto: swaps whoever
// holds idsA with whoever holds idsB (each side must currently be one person).
export class SwapInvigilationGroupsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("all", { each: true })
  idsA!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("all", { each: true })
  idsB!: string[];
}
