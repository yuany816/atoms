import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.PublishedApps import PublishedappsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/PublishedApps", tags=["PublishedApps"])


# ---------- Pydantic Schemas ----------
class PublishedappsData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: str
    name: str
    slug: str
    files: dict


class PublishedappsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[str] = None
    name: Optional[str] = None
    slug: Optional[str] = None
    files: Optional[dict] = None


class PublishedappsResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: str
    name: str
    slug: str
    files: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PublishedappsListResponse(BaseModel):
    """List response schema"""
    items: List[PublishedappsResponse]
    total: int
    skip: int
    limit: int


class PublishedappsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[PublishedappsData]


class PublishedappsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: PublishedappsUpdateData


class PublishedappsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[PublishedappsBatchUpdateItem]


class PublishedappsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=PublishedappsListResponse)
async def query_PublishedAppss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query PublishedAppss with filtering, sorting, and pagination"""
    logger.debug(f"Querying PublishedAppss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = PublishedappsService(db)
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
        logger.debug(f"Found {result['total']} PublishedAppss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid PublishedApps query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying PublishedAppss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=PublishedappsListResponse)
async def query_PublishedAppss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query PublishedAppss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying PublishedAppss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = PublishedappsService(db)
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
        logger.debug(f"Found {result['total']} PublishedAppss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid PublishedApps query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying PublishedAppss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=PublishedappsResponse)
async def get_PublishedApps(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single PublishedApps by ID"""
    logger.debug(f"Fetching PublishedApps with id: {id}, fields={fields}")
    
    service = PublishedappsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Publishedapps with id {id} not found")
            raise HTTPException(status_code=404, detail="Publishedapps not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching PublishedApps {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=PublishedappsResponse, status_code=201)
async def create_PublishedApps(
    data: PublishedappsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new PublishedApps"""
    logger.debug(f"Creating new PublishedApps with data: {data}")
    
    service = PublishedappsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create PublishedApps")
        
        logger.info(f"Publishedapps created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating PublishedApps: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating PublishedApps: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[PublishedappsResponse], status_code=201)
async def create_PublishedAppss_batch(
    request: PublishedappsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple PublishedAppss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} PublishedAppss")
    
    service = PublishedappsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} PublishedAppss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[PublishedappsResponse])
async def update_PublishedAppss_batch(
    request: PublishedappsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple PublishedAppss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} PublishedAppss")
    
    service = PublishedappsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} PublishedAppss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=PublishedappsResponse)
async def update_PublishedApps(
    id: int,
    data: PublishedappsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing PublishedApps"""
    logger.debug(f"Updating PublishedApps {id} with data: {data}")

    service = PublishedappsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Publishedapps with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Publishedapps not found")
        
        logger.info(f"Publishedapps {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating PublishedApps {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating PublishedApps {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_PublishedAppss_batch(
    request: PublishedappsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple PublishedAppss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} PublishedAppss")
    
    service = PublishedappsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} PublishedAppss successfully")
        return {"message": f"Successfully deleted {deleted_count} PublishedAppss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_PublishedApps(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single PublishedApps by ID"""
    logger.debug(f"Deleting PublishedApps with id: {id}")
    
    service = PublishedappsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Publishedapps with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Publishedapps not found")
        
        logger.info(f"Publishedapps {id} deleted successfully")
        return {"message": "Publishedapps deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting PublishedApps {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")