import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.GenerationLogs import GenerationlogsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/GenerationLogs", tags=["GenerationLogs"])


# ---------- Pydantic Schemas ----------
class GenerationlogsData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: str = None
    model: str = None
    user_message: str
    assistant_message: str = None
    kb_sources: str = None
    skill_names: str = None
    query: str = None


class GenerationlogsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[str] = None
    model: Optional[str] = None
    user_message: Optional[str] = None
    assistant_message: Optional[str] = None
    kb_sources: Optional[str] = None
    skill_names: Optional[str] = None
    query: Optional[str] = None


class GenerationlogsResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: Optional[str] = None
    model: Optional[str] = None
    user_message: str
    assistant_message: Optional[str] = None
    kb_sources: Optional[str] = None
    skill_names: Optional[str] = None
    query: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GenerationlogsListResponse(BaseModel):
    """List response schema"""
    items: List[GenerationlogsResponse]
    total: int
    skip: int
    limit: int


class GenerationlogsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[GenerationlogsData]


class GenerationlogsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: GenerationlogsUpdateData


class GenerationlogsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[GenerationlogsBatchUpdateItem]


class GenerationlogsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=GenerationlogsListResponse)
async def query_GenerationLogss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query GenerationLogss with filtering, sorting, and pagination"""
    logger.debug(f"Querying GenerationLogss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = GenerationlogsService(db)
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
        logger.debug(f"Found {result['total']} GenerationLogss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid GenerationLogs query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying GenerationLogss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=GenerationlogsListResponse)
async def query_GenerationLogss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query GenerationLogss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying GenerationLogss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = GenerationlogsService(db)
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
        logger.debug(f"Found {result['total']} GenerationLogss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid GenerationLogs query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying GenerationLogss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=GenerationlogsResponse)
async def get_GenerationLogs(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single GenerationLogs by ID"""
    logger.debug(f"Fetching GenerationLogs with id: {id}, fields={fields}")
    
    service = GenerationlogsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Generationlogs with id {id} not found")
            raise HTTPException(status_code=404, detail="Generationlogs not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching GenerationLogs {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=GenerationlogsResponse, status_code=201)
async def create_GenerationLogs(
    data: GenerationlogsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new GenerationLogs"""
    logger.debug(f"Creating new GenerationLogs with data: {data}")
    
    service = GenerationlogsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create GenerationLogs")
        
        logger.info(f"Generationlogs created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating GenerationLogs: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating GenerationLogs: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[GenerationlogsResponse], status_code=201)
async def create_GenerationLogss_batch(
    request: GenerationlogsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple GenerationLogss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} GenerationLogss")
    
    service = GenerationlogsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} GenerationLogss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[GenerationlogsResponse])
async def update_GenerationLogss_batch(
    request: GenerationlogsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple GenerationLogss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} GenerationLogss")
    
    service = GenerationlogsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} GenerationLogss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=GenerationlogsResponse)
async def update_GenerationLogs(
    id: int,
    data: GenerationlogsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing GenerationLogs"""
    logger.debug(f"Updating GenerationLogs {id} with data: {data}")

    service = GenerationlogsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Generationlogs with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Generationlogs not found")
        
        logger.info(f"Generationlogs {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating GenerationLogs {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating GenerationLogs {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_GenerationLogss_batch(
    request: GenerationlogsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple GenerationLogss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} GenerationLogss")
    
    service = GenerationlogsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} GenerationLogss successfully")
        return {"message": f"Successfully deleted {deleted_count} GenerationLogss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_GenerationLogs(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single GenerationLogs by ID"""
    logger.debug(f"Deleting GenerationLogs with id: {id}")
    
    service = GenerationlogsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Generationlogs with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Generationlogs not found")
        
        logger.info(f"Generationlogs {id} deleted successfully")
        return {"message": "Generationlogs deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting GenerationLogs {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")