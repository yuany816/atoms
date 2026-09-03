import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.AppRecords import ApprecordsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/AppRecords", tags=["AppRecords"])


# ---------- Pydantic Schemas ----------
class ApprecordsData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: str
    entity_type: str
    data: dict


class ApprecordsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[str] = None
    entity_type: Optional[str] = None
    data: Optional[dict] = None


class ApprecordsResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: str
    entity_type: str
    data: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ApprecordsListResponse(BaseModel):
    """List response schema"""
    items: List[ApprecordsResponse]
    total: int
    skip: int
    limit: int


class ApprecordsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ApprecordsData]


class ApprecordsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ApprecordsUpdateData


class ApprecordsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ApprecordsBatchUpdateItem]


class ApprecordsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ApprecordsListResponse)
async def query_AppRecordss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query AppRecordss with filtering, sorting, and pagination"""
    logger.debug(f"Querying AppRecordss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ApprecordsService(db)
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
        logger.debug(f"Found {result['total']} AppRecordss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid AppRecords query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying AppRecordss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ApprecordsListResponse)
async def query_AppRecordss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query AppRecordss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying AppRecordss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ApprecordsService(db)
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
        logger.debug(f"Found {result['total']} AppRecordss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid AppRecords query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying AppRecordss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ApprecordsResponse)
async def get_AppRecords(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single AppRecords by ID"""
    logger.debug(f"Fetching AppRecords with id: {id}, fields={fields}")
    
    service = ApprecordsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Apprecords with id {id} not found")
            raise HTTPException(status_code=404, detail="Apprecords not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching AppRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ApprecordsResponse, status_code=201)
async def create_AppRecords(
    data: ApprecordsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new AppRecords"""
    logger.debug(f"Creating new AppRecords with data: {data}")
    
    service = ApprecordsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create AppRecords")
        
        logger.info(f"Apprecords created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating AppRecords: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating AppRecords: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ApprecordsResponse], status_code=201)
async def create_AppRecordss_batch(
    request: ApprecordsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple AppRecordss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} AppRecordss")
    
    service = ApprecordsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} AppRecordss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ApprecordsResponse])
async def update_AppRecordss_batch(
    request: ApprecordsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple AppRecordss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} AppRecordss")
    
    service = ApprecordsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} AppRecordss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ApprecordsResponse)
async def update_AppRecords(
    id: int,
    data: ApprecordsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing AppRecords"""
    logger.debug(f"Updating AppRecords {id} with data: {data}")

    service = ApprecordsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Apprecords with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Apprecords not found")
        
        logger.info(f"Apprecords {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating AppRecords {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating AppRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_AppRecordss_batch(
    request: ApprecordsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple AppRecordss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} AppRecordss")
    
    service = ApprecordsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} AppRecordss successfully")
        return {"message": f"Successfully deleted {deleted_count} AppRecordss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_AppRecords(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single AppRecords by ID"""
    logger.debug(f"Deleting AppRecords with id: {id}")
    
    service = ApprecordsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Apprecords with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Apprecords not found")
        
        logger.info(f"Apprecords {id} deleted successfully")
        return {"message": "Apprecords deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting AppRecords {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")