import { BadRequestException, NotFoundException, Injectable, Logger } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { InternalServerErrorException } from '@nestjs/common'
import { DataSource, Repository } from 'typeorm';
import { PaginationDto } from 'src/common/dtos/pagination.dto';
import { validate as isUUID } from 'uuid'
import { Product, ProductImage } from './entities';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger("ProductsService")
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,
    private readonly dataSource: DataSource
  ) { }

  async create(createProductDto: CreateProductDto) {
    try {
      const {images = [], ...productDetails} = createProductDto;

      const product = this.productRepository.create({
        ...productDetails,
        images: images.map(image => this.productImageRepository.create({url: image}))
      })
      await this.productRepository.save(product)
      return {product, images}; 
      
    } catch (error) {
      this.handleDBExceptions(error)
    }
  }

  async findAll(paginationDto: PaginationDto) {
    const {limit = 10, offset = 0} = paginationDto
    const products = await this.productRepository.find({
      take: limit,
      skip: offset,
      relations: {
        images:  true
      }
    });
    return products.map((product) => ({
      ...product,
      images: product.images.map((img) => img.url)
    }))
  }


  async findOne(term: string) {

    let product: Product
    if(isUUID(term)) {
      product =  await this.productRepository.findOneBy({id: term});
    } else {
      const queryBuilder = this.productRepository.createQueryBuilder('prod')
      product =  await queryBuilder
      .where('UPPER(title) =:title or slug =:slug', {
        title: term.toUpperCase(),
        slug: term.toLowerCase()
      })
      .leftJoinAndSelect('prod.images', 'prodImages')
      .getOne()

    }

    if(!product) throw new NotFoundException(`Product with ${term} not found`)
    return product
  }

  async update(id: string, updateProductDto: UpdateProductDto) {

    const {images, ...toUpdate} = updateProductDto;
    
    const product = await  this.productRepository.preload({
      id, 
      ...toUpdate
    })
    
    if(!product) throw new NotFoundException(`Podruct with id: ${id} not found`)
   
    // Create query runner
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect()
      await  queryRunner.startTransaction()
    
    try {
      if(images) {
        queryRunner.manager.delete(ProductImage, { product: { id } })
        product.images = images.map((url) => this.productImageRepository.create({url}))
      }
      await queryRunner.manager.save(product)
      await queryRunner.commitTransaction()
      return this.findOnePlain(id)
    } catch (error) {
      await queryRunner.rollbackTransaction()
      this.handleDBExceptions(error)
    } finally {
      const t = await queryRunner.release()
    }
  }

  async remove(id: string) {

    const product =  await this.productRepository.findOneBy({id});
    if(!product) throw new NotFoundException(`Product with id ${id} not found`)

    return await this.productRepository.remove(product);
  }

  async  deleteAllProducts() {
    const query = this.productRepository.createQueryBuilder('product')

    try {
      return await query
      .delete()
      .where({})
      .execute();
      
    } catch (error) {
      this.handleDBExceptions(error)
    }
  }


  handleDBExceptions(error: any) {
    if(error.code === '23505') {
      throw new BadRequestException(error.detail)
    } 

    this.logger.error(error)
    throw new InternalServerErrorException('unexpected error, check server logs!')
  }


  async findOnePlain(term: string) {
    const {images = [], ...rest} = await this.findOne(term)

    return {
      ...rest,
      images: images.map(img => img.url)
    }
  }
}
