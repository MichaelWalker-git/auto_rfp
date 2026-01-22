import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
import { isApiError, ValidationError } from '@/lib/errors/api-errors';

type ApiHandler<T = any> = (
  request: NextRequest,
  validatedData: T
) => Promise<NextResponse>;

interface ApiHandlerOptions<T> {
  validationSchema?: ZodSchema<any>;
  skipValidation?: boolean;
}

export function withApiHandler<T = any>(
  handler: ApiHandler<T>,
  options: ApiHandlerOptions<T> = {}
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    try {
      let validatedData: T;

      if (options.skipValidation) {
        validatedData = {} as T;
      } else if (options.validationSchema) {
        const body = await request.json();
        const result = options.validationSchema.safeParse(body);
        
        if (!result.success) {
          throw new ValidationError('Invalid request data', result.error.errors);
        }
        
        validatedData = result.data as T;
      } else {
        validatedData = await request.json();
      }

      return await handler(request, validatedData);
    } catch (error) {
      console.error('API Error:', error);
      
      if (isApiError(error)) {
        return NextResponse.json(
          { 
            error: error.message, 
            code: error.code,
            ...(error instanceof ValidationError && { details: error.details })
          },
          { status: error.statusCode }
        );
      }

      // Unexpected error
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

/**
 * Simplified API handler for manual validation scenarios
 */
export async function apiHandler<T = any>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await handler();
    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error:', error);
    
    if (isApiError(error)) {
      return NextResponse.json(
        { 
          error: error.message, 
          code: error.code,
          ...(error instanceof ValidationError && { details: error.details })
        },
        { status: error.statusCode }
      );
    }

    // Unexpected error
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 