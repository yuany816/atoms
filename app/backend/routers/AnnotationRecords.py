import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.AnnotationRecords import AnnotationrecordsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/AnnotationRecords", tags=["AnnotationRecords"])


# ---------- Pydantic Schemas ----------
class AnnotationrecordsData(BaseModel):
    """Entity data schema (for create/update)"""
    log_id: int
    label: str
    note: str = None


class AnnotationrecordsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    log_id: Optional[int] = None
    label: Optional[str] = None
    note: Optional[str] = None


class AnnotationrecordsResponse(BaseModel):
    """Entity response schema"""
    id: int
    log_id: int
    label: str
    note: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AnnotationrecordsListResponse(BaseModel):
    """List response schema"""
    items: List[AnnotationrecordsResponse]
    total: int
    skip: int
    limit: int


class AnnotationrecordsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[AnnotationrecordsData]


class AnnotationrecordsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: AnnotationrecordsUpdateData


class AnnotationrecordsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[AnnotationrecordsBatchUpdateItem]


class AnnotationrecordsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=AnnotationrecordsListResponse)
async def query_AnnotationRecordss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query AnnotationRecordss with filtering, sorting, and pagination"""
    logger.debug(f"Querying AnnotationRecordss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = AnnotationrecordsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} AnnotationRecordss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid AnnotationRecords query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying AnnotationRecordss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=AnnotationrecordsListResponse)
async def query_AnnotationRecordss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query AnnotationRecordss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying AnnotationRecordss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = AnnotationrecordsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} AnnotationRecordss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid AnnotationRecords query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying AnnotationRecordss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=AnnotationrecordsResponse)
async def get_AnnotationRecords(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single AnnotationRecords by ID"""
    logger.debug(f"Fetching AnnotationRecords with id: {id}, fields={fields}")
    
    service = AnnotationrecordsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Annotationrecords with id {id} not found")
            raise HTTPException(status_code=404, detail="Annotationrecords not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching AnnotationRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=AnnotationrecordsResponse, status_code=201)
async def create_AnnotationRecords(
    data: AnnotationrecordsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new AnnotationRecords"""
    logger.debug(f"Creating new AnnotationRecords with data: {data}")
    
    service = AnnotationrecordsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create AnnotationRecords")
        
        logger.info(f"Annotationrecords created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating AnnotationRecords: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating AnnotationRecords: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[AnnotationrecordsResponse], status_code=201)
async def create_AnnotationRecordss_batch(
    request: AnnotationrecordsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple AnnotationRecordss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} AnnotationRecordss")
    
    service = AnnotationrecordsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} AnnotationRecordss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[AnnotationrecordsResponse])
async def update_AnnotationRecordss_batch(
    request: AnnotationrecordsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple AnnotationRecordss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} AnnotationRecordss")
    
    service = AnnotationrecordsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} AnnotationRecordss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=AnnotationrecordsResponse)
async def update_AnnotationRecords(
    id: int,
    data: AnnotationrecordsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing AnnotationRecords"""
    logger.debug(f"Updating AnnotationRecords {id} with data: {data}")

    service = AnnotationrecordsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Annotationrecords with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Annotationrecords not found")
        
        logger.info(f"Annotationrecords {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating AnnotationRecords {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating AnnotationRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_AnnotationRecordss_batch(
    request: AnnotationrecordsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple AnnotationRecordss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} AnnotationRecordss")
    
    service = AnnotationrecordsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} AnnotationRecordss successfully")
        return {"message": f"Successfully deleted {deleted_count} AnnotationRecordss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_AnnotationRecords(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single AnnotationRecords by ID"""
    logger.debug(f"Deleting AnnotationRecords with id: {id}")
    
    service = AnnotationrecordsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Annotationrecords with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Annotationrecords not found")
        
        logger.info(f"Annotationrecords {id} deleted successfully")
        return {"message": "Annotationrecords deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting AnnotationRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")