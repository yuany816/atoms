import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.SkillPackages import SkillpackagesService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/SkillPackages", tags=["SkillPackages"])


# ---------- Pydantic Schemas ----------
class SkillpackagesData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    file_name: str = None
    file_type: str
    scenes: str = None
    description: str = None
    usage: str = None
    content: str
    enabled: bool = None


class SkillpackagesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    scenes: Optional[str] = None
    description: Optional[str] = None
    usage: Optional[str] = None
    content: Optional[str] = None
    enabled: Optional[bool] = None


class SkillpackagesResponse(BaseModel):
    """Entity response schema"""
    id: int
    name: str
    file_name: Optional[str] = None
    file_type: str
    scenes: Optional[str] = None
    description: Optional[str] = None
    usage: Optional[str] = None
    content: str
    enabled: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SkillpackagesListResponse(BaseModel):
    """List response schema"""
    items: List[SkillpackagesResponse]
    total: int
    skip: int
    limit: int


class SkillpackagesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[SkillpackagesData]


class SkillpackagesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: SkillpackagesUpdateData


class SkillpackagesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[SkillpackagesBatchUpdateItem]


class SkillpackagesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=SkillpackagesListResponse)
async def query_SkillPackagess(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query SkillPackagess with filtering, sorting, and pagination"""
    logger.debug(f"Querying SkillPackagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = SkillpackagesService(db)
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
        logger.debug(f"Found {result['total']} SkillPackagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid SkillPackages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying SkillPackagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=SkillpackagesListResponse)
async def query_SkillPackagess_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query SkillPackagess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying SkillPackagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = SkillpackagesService(db)
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
        logger.debug(f"Found {result['total']} SkillPackagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid SkillPackages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying SkillPackagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=SkillpackagesResponse)
async def get_SkillPackages(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single SkillPackages by ID"""
    logger.debug(f"Fetching SkillPackages with id: {id}, fields={fields}")
    
    service = SkillpackagesService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Skillpackages with id {id} not found")
            raise HTTPException(status_code=404, detail="Skillpackages not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching SkillPackages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=SkillpackagesResponse, status_code=201)
async def create_SkillPackages(
    data: SkillpackagesData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new SkillPackages"""
    logger.debug(f"Creating new SkillPackages with data: {data}")
    
    service = SkillpackagesService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create SkillPackages")
        
        logger.info(f"Skillpackages created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating SkillPackages: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating SkillPackages: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[SkillpackagesResponse], status_code=201)
async def create_SkillPackagess_batch(
    request: SkillpackagesBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple SkillPackagess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} SkillPackagess")
    
    service = SkillpackagesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} SkillPackagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[SkillpackagesResponse])
async def update_SkillPackagess_batch(
    request: SkillpackagesBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple SkillPackagess in a single request"""
    logger.debug(f"Batch updating {len(request.items)} SkillPackagess")
    
    service = SkillpackagesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} SkillPackagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=SkillpackagesResponse)
async def update_SkillPackages(
    id: int,
    data: SkillpackagesUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing SkillPackages"""
    logger.debug(f"Updating SkillPackages {id} with data: {data}")

    service = SkillpackagesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Skillpackages with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Skillpackages not found")
        
        logger.info(f"Skillpackages {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating SkillPackages {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating SkillPackages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_SkillPackagess_batch(
    request: SkillpackagesBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple SkillPackagess by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} SkillPackagess")
    
    service = SkillpackagesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} SkillPackagess successfully")
        return {"message": f"Successfully deleted {deleted_count} SkillPackagess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_SkillPackages(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single SkillPackages by ID"""
    logger.debug(f"Deleting SkillPackages with id: {id}")
    
    service = SkillpackagesService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Skillpackages with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Skillpackages not found")
        
        logger.info(f"Skillpackages {id} deleted successfully")
        return {"message": "Skillpackages deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting SkillPackages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")