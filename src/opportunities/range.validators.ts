import { Prisma } from '../generated/prisma/client.js';
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const DECIMAL_PATTERN = /^-?\d{1,16}(?:\.\d{1,2})?$/;

@ValidatorConstraint({ name: 'maxValueNotBelowMinValue', async: false })
export class MaxValueNotBelowMinValueConstraint
  implements ValidatorConstraintInterface
{
  validate(maxValue: unknown, args: ValidationArguments): boolean {
    const [minValueProperty] = args.constraints as [string];
    const minValue = (args.object as Record<string, unknown>)[minValueProperty];

    if (maxValue === undefined || minValue === undefined) return true;
    if (
      typeof maxValue !== 'string' ||
      typeof minValue !== 'string' ||
      !DECIMAL_PATTERN.test(maxValue) ||
      !DECIMAL_PATTERN.test(minValue)
    ) {
      return true;
    }

    return !new Prisma.Decimal(minValue).greaterThan(maxValue);
  }

  defaultMessage(): string {
    return 'maxValue must be greater than or equal to minValue';
  }
}

@ValidatorConstraint({ name: 'createdBeforeNotEarlierThanCreatedAfter', async: false })
export class CreatedBeforeNotEarlierThanCreatedAfterConstraint
  implements ValidatorConstraintInterface
{
  validate(createdBefore: unknown, args: ValidationArguments): boolean {
    const [createdAfterProperty] = args.constraints as [string];
    const createdAfter = (args.object as Record<string, unknown>)[
      createdAfterProperty
    ];

    if (createdBefore === undefined || createdAfter === undefined) return true;
    if (typeof createdBefore !== 'string' || typeof createdAfter !== 'string') {
      return true;
    }

    const beforeTime = Date.parse(createdBefore);
    const afterTime = Date.parse(createdAfter);
    if (Number.isNaN(beforeTime) || Number.isNaN(afterTime)) return true;

    return beforeTime >= afterTime;
  }

  defaultMessage(): string {
    return 'createdBefore must be later than or equal to createdAfter';
  }
}
