import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.ShareLinks import SharelinksService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/ShareLinks", tags=["ShareLinks"])


# ---------- Pydantic Schemas ----------
class SharelinksData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: str
    token: str
    name: str
    snapshot: dict


class SharelinksUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[str] = None
    token: Optional[str] = None
    name: Optional[str] = None
    snapshot: Optional[dict] = None


class SharelinksResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: str
    token: str
    name: str
    snapshot: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SharelinksListResponse(BaseModel):
    """List response schema"""
    items: List[SharelinksResponse]
    total: int
    skip: int
    limit: int


class SharelinksBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[SharelinksData]


class SharelinksBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: SharelinksUpdateData


class SharelinksBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[SharelinksBatchUpdateItem]


class SharelinksBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=SharelinksListResponse)
async def query_ShareLinkss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query ShareLinkss with filtering, sorting, and pagination"""
    logger.debug(f"Querying ShareLinkss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = SharelinksService(db)
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
        logger.debug(f"Found {result['total']} ShareLinkss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid ShareLinks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying ShareLinkss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=SharelinksListResponse)
async def query_ShareLinkss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query ShareLinkss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying ShareLinkss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = SharelinksService(db)
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
        logger.debug(f"Found {result['total']} ShareLinkss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid ShareLinks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying ShareLinkss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=SharelinksResponse)
async def get_ShareLinks(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single ShareLinks by ID"""
    logger.debug(f"Fetching ShareLinks with id: {id}, fields={fields}")
    
    service = SharelinksService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Sharelinks with id {id} not found")
            raise HTTPException(status_code=404, detail="Sharelinks not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ShareLinks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=SharelinksResponse, status_code=201)
async def create_ShareLinks(
    data: SharelinksData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new ShareLinks"""
    logger.debug(f"Creating new ShareLinks with data: {data}")
    
    service = SharelinksService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create ShareLinks")
        
        logger.info(f"Sharelinks created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating ShareLinks: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating ShareLinks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[SharelinksResponse], status_code=201)
async def create_ShareLinkss_batch(
    request: SharelinksBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple ShareLinkss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} ShareLinkss")
    
    service = SharelinksService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} ShareLinkss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[SharelinksResponse])
async def update_ShareLinkss_batch(
    request: SharelinksBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple ShareLinkss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} ShareLinkss")
    
    service = SharelinksService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} ShareLinkss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=SharelinksResponse)
async def update_ShareLinks(
    id: int,
    data: SharelinksUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing ShareLinks"""
    logger.debug(f"Updating ShareLinks {id} with data: {data}")

    service = SharelinksService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Sharelinks with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Sharelinks not found")
        
        logger.info(f"Sharelinks {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating ShareLinks {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating ShareLinks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_ShareLinkss_batch(
    request: SharelinksBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple ShareLinkss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} ShareLinkss")
    
    service = SharelinksService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} ShareLinkss successfully")
        return {"message": f"Successfully deleted {deleted_count} ShareLinkss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_ShareLinks(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single ShareLinks by ID"""
    logger.debug(f"Deleting ShareLinks with id: {id}")
    
    service = SharelinksService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Sharelinks with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Sharelinks not found")
        
        logger.info(f"Sharelinks {id} deleted successfully")
        return {"message": "Sharelinks deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting ShareLinks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")