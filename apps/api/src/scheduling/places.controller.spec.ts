import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { SchedulingService } from './scheduling.service';
import { PlacesController } from './places.controller';
import { UpdatePlaceDto } from './dto/update-place.dto';

const PLACE_ID = 'f7a6ef17-b06f-421b-bf3f-ddb77972098f';
const fakeRequest = { user: { sub: 'user-1' } };

describe('PlacesController', () => {
  let controller: PlacesController;
  const schedulingService = {
    listAvailablePlaces: jest.fn(),
    updatePlace: jest.fn(),
    removeSavedPlace: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlacesController],
      providers: [{ provide: SchedulingService, useValue: schedulingService }],
    }).compile();
    controller = module.get(PlacesController);
  });

  afterEach(() => jest.clearAllMocks());

  it('exposes PATCH /places/:id and delegates with the authenticated user', async () => {
    schedulingService.updatePlace.mockResolvedValue({ id: PLACE_ID, name: 'Cafe' });

    await controller.update(PLACE_ID, { name: 'Cafe' }, fakeRequest);

    expect(Reflect.getMetadata(PATH_METADATA, controller.update)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.update)).toBe(RequestMethod.PATCH);
    expect(schedulingService.updatePlace).toHaveBeenCalledWith(
      PLACE_ID,
      { name: 'Cafe' },
      'user-1',
    );
  });

  it('validates place names as nonblank and at most 100 characters', async () => {
    const dto = new UpdatePlaceDto();
    dto.name = '   ';
    expect(await validate(dto)).not.toHaveLength(0);

    dto.name = 'a'.repeat(101);
    expect(await validate(dto)).not.toHaveLength(0);

    dto.name = 'A valid place';
    expect(await validate(dto)).toHaveLength(0);
  });
});
