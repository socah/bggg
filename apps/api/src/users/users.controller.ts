import { Body, Controller, Delete, Get, HttpCode, Patch, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@Controller('users/me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly keycloakAdmin: KeycloakAdminClient,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  getProfile(@Request() request: AuthenticatedRequest) {
    return this.keycloakAdmin.getUser(request.user.sub);
  }

  @Patch()
  updateProfile(
    @Request() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.keycloakAdmin.updateUser(request.user.sub, {
      email: dto.email?.trim(),
      firstName: dto.firstName?.trim(),
      lastName: dto.lastName?.trim(),
    });
  }

  @Delete()
  @HttpCode(204)
  deleteAccount(@Request() request: AuthenticatedRequest) {
    return this.usersService.deleteAccount(request.user.sub);
  }
}
